import "./estilo.css";
import { CANDIDATOS, NOMES_UF, REGIOES, UF_IBGE, carregar, fatiaLula, fmt, pctSecoes, somar, type Estado, type Votos } from "./dados";
import { Mapa } from "./mapa";
import { montarBusca, type Item } from "./busca";

type Modo = "municipios" | "estados" | "vantagem" | "mudanca" | "candidato";
type Numero = "13" | "22";

const BASE = import.meta.env.BASE_URL;
const URL_1T = `${BASE}dados/1t.json`;
const URL_2T = `${BASE}dados/2t/agora.json`;
const INTERVALO_MS = 30_000;

const el = {
  status: document.getElementById("status")!,
  pontoVivo: document.getElementById("ponto-vivo")!,
  aviso: document.getElementById("aviso")!,
  turno: document.getElementById("turno")!,
  placar: document.getElementById("placar")!,
  legenda: document.getElementById("legenda")!,
  detalhe: document.getElementById("detalhe")!,
  regioes: document.getElementById("regioes")!,
};

let primeiro: Estado;
let segundo: Estado | null = null;
let modo: Modo = "municipios";
let candidato: Numero = "13";
let selecionado: string | null = null;

/** O que está sendo exibido: o 2º turno quando existir, senão o resultado final do 1º */
const atual = () => segundo ?? primeiro;

// ---------- cores ----------

const css = getComputedStyle(document.documentElement);
const rgb = (nome: string) => css.getPropertyValue(nome).trim().match(/\d+/g)!.map(Number);
const LULA = rgb("--lula-rgb");
const FLAVIO = rgb("--flavio-rgb");
const NEUTRO = rgb("--neutro-rgb");

function misturar(a: number[], b: number[], t: number) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Quem lidera, em cor cheia */
function corLider(v: Votos): string | null {
  const f = fatiaLula(v);
  if (f === null) return null;
  return misturar(NEUTRO, f >= 0.5 ? LULA : FLAVIO, 1);
}

/** Vantagem: cor do líder, mais forte quanto maior a vantagem (saturando em 40 pontos) */
function corVantagem(v: Votos): string | null {
  const f = fatiaLula(v);
  if (f === null) return null;
  const vantagem = Math.abs(f - 0.5) * 2;
  return misturar(NEUTRO, f >= 0.5 ? LULA : FLAVIO, 0.2 + vantagem / 0.4 * 0.8);
}

/** Candidato: % dos votos válidos do candidato escolhido, de 20% (claro) a 70% (cor cheia) */
function corCandidato(v: Votos): string | null {
  if (!v.validos) return null;
  const pct = v[candidato] / v.validos;
  return misturar(NEUTRO, candidato === "13" ? LULA : FLAVIO, (pct - 0.2) / 0.5);
}

/** Mudança: para que lado a fatia do confronto direto andou desde o 1º turno (saturando em 15 pontos) */
function corMudanca(agora: Votos, antes: Votos | undefined): string | null {
  const f2 = fatiaLula(agora);
  const f1 = antes && fatiaLula(antes);
  if (f2 == null || f1 == null) return null;
  const delta = f2 - f1;
  return misturar(NEUTRO, delta >= 0 ? LULA : FLAVIO, Math.abs(delta) / 0.15);
}

function cor(agora: Votos, antes: Votos | undefined): string | null {
  switch (modo) {
    case "municipios":
    case "estados":
      return corLider(agora);
    case "vantagem":
      return corVantagem(agora);
    case "candidato":
      return corCandidato(agora);
    case "mudanca":
      return segundo ? corMudanca(agora, antes) : null;
  }
}

function pintor(codigo: string) {
  // No modo Estados, cada município recebe a cor do seu estado
  if (modo === "estados") return pintorUf(UF_IBGE[codigo.slice(0, 2)]);
  const agora = atual().municipios[codigo];
  return agora ? cor(agora, primeiro.municipios[codigo]) : null;
}

function pintorUf(uf: string) {
  const agora = atual().ufs[uf];
  return agora ? cor(agora, primeiro.ufs[uf]) : null;
}

const pintarMapa = () => mapa.pintar(pintor, pintorUf);

// ---------- renderização ----------

const INICIO_2T = Date.parse("2026-10-25T17:00:00-03:00");
const doisDigitos = (n: number) => String(n).padStart(2, "0");

function contagemRegressiva() {
  let s = Math.max(0, Math.floor((INICIO_2T - Date.now()) / 1000));
  const dias = Math.floor(s / 86400);
  s -= dias * 86400;
  const relogio = `${doisDigitos(Math.floor(s / 3600))}:${doisDigitos(Math.floor((s % 3600) / 60))}:${doisDigitos(s % 60)}`;
  return dias ? `${dias} ${dias === 1 ? "dia" : "dias"} · ${relogio}` : relogio;
}

function renderStatus() {
  el.pontoVivo.classList.toggle("ativo", !!segundo);
  if (segundo) {
    const pct = pctSecoes(segundo.br);
    const hora = segundo.gerado ? `Atualizado às ${segundo.gerado.slice(-8, -3).replace(":", "h")} · ` : "";
    el.status.textContent = `${hora}${fmt.pct1(pct / 100)} das seções`;
    el.turno.textContent = "2º turno · 25 de outubro";
  } else {
    el.status.textContent = `2º turno começa em ${contagemRegressiva()}`;
    el.turno.textContent = "1º turno · resultado final";
  }
}

function renderPlacar() {
  const br = atual().br;
  const lado = (n: "13" | "22") => {
    const c = CANDIDATOS[n];
    const pct = br.validos ? br[n] / br.validos : 0;
    return `<div class="cand cand-${n}">
      <div class="cand-id">
        <img class="cand-foto" src="${BASE}fotos/${n}.png" alt="${c.nome}" width="56" height="56" />
        <span class="cand-nome">${c.nome}<small>${c.partido} ${n}</small></span>
      </div>
      <span class="cand-pct">${fmt.pct(pct)}</span>
      <span class="cand-votos">${fmt.num(br[n])} votos</span>
    </div>`;
  };
  const lider = br["13"] >= br["22"] ? "13" : "22";
  const diferenca = Math.abs(br["13"] - br["22"]);
  const fatia = fatiaLula(br) ?? 0.5;
  const titulo = br["13"] + br["22"] === 0
    ? "Aguardando os primeiros votos"
    : `<em class="cor-${lider}">${CANDIDATOS[lider].nome}</em> ${segundo ? "lidera" : "terminou na frente"} por ${fmt.milhoes(diferenca)} de votos`;

  el.placar.innerHTML = `
    <p class="placar-rotulo">Presidente · Brasil${segundo ? "" : " · 1º turno"}</p>
    <h2 class="placar-titulo">${titulo}</h2>
    <div class="placar-cands">${lado("13")}${lado("22")}</div>
    <div class="barra" role="img" aria-label="Lula ${fmt.pct1(fatia)} contra Flávio ${fmt.pct1(1 - fatia)} no confronto direto">
      <span class="barra-13" style="width:${fatia * 100}%"></span>
      <span class="barra-22" style="width:${(1 - fatia) * 100}%"></span>
      <i class="barra-meio"></i>
    </div>
    <dl class="placar-numeros">
      <div><dt>Comparecimento</dt><dd>${br.eleitores ? fmt.pct1(br.comparecimento / br.eleitores) : "—"}</dd></div>
      <div><dt>Votos válidos</dt><dd>${fmt.num(br.validos)}</dd></div>
      ${segundo ? "" : `<div><dt>Outros candidatos</dt><dd>${br.validos ? fmt.pct1(br.outros / br.validos) : "—"}</dd></div>`}
    </dl>`;
}

function renderDicas() {
  const aba = document.querySelector<HTMLElement>('[data-modo="mudanca"]')!;
  if (segundo) delete aba.dataset.dica;
  else aba.dataset.dica = "Compara cada município com o 1º turno. As cores aparecem quando a apuração do 2º turno começar, domingo às 17h.";
}

function renderLegenda() {
  const lideres = `<span><i class="ponto cor-13"></i>Lula</span><span><i class="ponto cor-22"></i>Flávio</span>`;
  const c = CANDIDATOS[candidato];
  const legendas: Record<Modo, string> = {
    municipios: `${lideres}<span class="nota">quem lidera em cada município</span>`,
    estados: `${lideres}<span class="nota">quem lidera em cada estado</span>`,
    vantagem: `${lideres}<span class="nota">cor mais forte = vantagem maior</span>`,
    candidato: `<span class="escala escala-${candidato}"><small>20%</small><i></i><small>70%</small></span><span class="nota">dos votos válidos para ${c.curto}</span>`,
    mudanca: segundo
      ? `<span><i class="ponto cor-13"></i>Lula ganhou terreno</span><span><i class="ponto cor-22"></i>Flávio ganhou terreno</span>`
      : `<span class="nota">Disponível quando a apuração do 2º turno começar.</span>`,
  };
  el.legenda.innerHTML = legendas[modo];
  document.getElementById("rotulo-candidato")!.textContent = modo === "candidato" ? c.curto : "Candidato";
}

function linhaCandidatos(v: Votos) {
  return (["13", "22"] as const)
    .map((n) => `<div class="linha"><span><i class="ponto cor-${n}"></i>${CANDIDATOS[n].nome}</span><b>${v.validos ? fmt.pct(v[n] / v.validos) : "—"}</b><small>${fmt.num(v[n])}</small></div>`)
    .join("");
}

/** Resultado de um código do mapa: município (código IBGE) ou estado ("uf:<sigla>") */
function buscarArea(estado: Estado, codigo: string): { nome: string; uf: string; v: Votos } | null {
  if (codigo.startsWith("uf:")) {
    const uf = codigo.slice(3);
    return estado.ufs[uf] ? { nome: NOMES_UF[uf], uf, v: estado.ufs[uf] } : null;
  }
  const m = estado.municipios[codigo];
  return m ? { nome: nomeProprio(m.nome), uf: m.uf, v: m } : null;
}

function renderDetalhe() {
  const area = selecionado ? buscarArea(atual(), selecionado) : null;
  if (!area) {
    el.detalhe.hidden = true;
    return;
  }
  const m = area.v;
  const antes = buscarArea(primeiro, selecionado!)?.v;
  let comparacao = "";
  if (segundo && antes) {
    const f1 = fatiaLula(antes), f2 = fatiaLula(m);
    if (f1 != null && f2 != null) {
      const quem = f2 >= f1 ? "Lula" : "Flávio";
      comparacao = `<p class="nota">No confronto direto, ${quem} ganhou ${fmt.pontos(f2 - f1)} desde o 1º turno.</p>`;
    }
  }
  el.detalhe.hidden = false;
  el.detalhe.innerHTML = `
    <button class="fechar" aria-label="Fechar">×</button>
    <h3>${area.nome} ${selecionado!.startsWith("uf:") ? "" : `<small>${area.uf.toUpperCase()}</small>`}</h3>
    ${segundo ? `<p class="nota">${fmt.pct1(pctSecoes(m) / 100)} das seções apuradas</p>` : ""}
    ${linhaCandidatos(m)}
    <p class="nota">Comparecimento ${m.eleitores ? fmt.pct1(m.comparecimento / m.eleitores) : "—"} · ${fmt.num(m.eleitores)} eleitores</p>
    ${comparacao}`;
  el.detalhe.querySelector(".fechar")!.addEventListener("click", () => {
    selecionado = null;
    renderDetalhe();
  });
}

function renderRegioes() {
  const ufs = atual().ufs;
  el.regioes.innerHTML = `<h2>Por região</h2>` + Object.entries(REGIOES)
    .map(([nome, siglas]) => {
      const v = somar(siglas.map((s) => ufs[s]).filter(Boolean));
      const f = fatiaLula(v);
      const lider = f == null ? null : f >= 0.5 ? "13" : "22";
      return `<div class="regiao">
        <div class="regiao-topo"><span>${nome}</span>${lider ? `<b class="cor-${lider}">${CANDIDATOS[lider].curto} ${fmt.pct1(v[lider] / v.validos)}</b>` : "<b>—</b>"}</div>
        <div class="barra fina"><span class="barra-13" style="width:${(f ?? 0.5) * 100}%"></span><span class="barra-22" style="width:${(1 - (f ?? 0.5)) * 100}%"></span><i class="barra-meio"></i></div>
        ${segundo ? `<small>${fmt.pct1(pctSecoes(v) / 100)} apurado</small>` : ""}
      </div>`;
    })
    .join("");
}

function renderTudo() {
  renderStatus();
  renderPlacar();
  renderLegenda();
  renderDicas();
  renderRegioes();
  renderDetalhe();
  pintarMapa();
}

// ---------- início ----------

const mapa = new Mapa(document.getElementById("mapa")!);
/** No modo Estados, passar ou clicar num município vale pelo estado inteiro */
const paraModo = (codigo: string | null) =>
  codigo && modo === "estados" && !codigo.startsWith("uf:") ? `uf:${UF_IBGE[codigo.slice(0, 2)]}` : codigo;

mapa.onSelecionar = (codigo) => {
  selecionado = paraModo(codigo);
  renderDetalhe();
};

const dicaMapa = document.getElementById("dica-mapa")!;
const nomeProprio = (nome: string) =>
  nome
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep, letra) => sep + letra.toUpperCase())
    .replace(/ (D[aeo]s?|E) /g, (p) => p.toLowerCase())
    .replace(/D'(\p{L})/gu, (_, letra) => "d'" + letra.toUpperCase());

mapa.onPassar = (bruto, x, y) => {
  const codigo = paraModo(bruto);
  if (!codigo) {
    dicaMapa.hidden = true;
    return;
  }
  if (codigo.startsWith("uf:")) {
    const uf = codigo.slice(3);
    dicaMapa.innerHTML = uf === "zz" ? `<b>Exterior</b>` : `<b>${uf.toUpperCase()}</b><span>${NOMES_UF[uf]}</span>`;
  } else {
    const uf = UF_IBGE[codigo.slice(0, 2)];
    const municipio = atual().municipios[codigo];
    dicaMapa.innerHTML = `<b>${uf.toUpperCase()}</b>${municipio ? `<span>${nomeProprio(municipio.nome)}</span>` : ""}`;
  }
  dicaMapa.hidden = false;
  // Perto das bordas, a caixa vai para o outro lado do cursor para não ser cortada
  const caixa = dicaMapa.parentElement!;
  const px = x + 14 + dicaMapa.offsetWidth > caixa.clientWidth ? x - 14 - dicaMapa.offsetWidth : x + 14;
  const py = y + 14 + dicaMapa.offsetHeight > caixa.clientHeight ? y - 14 - dicaMapa.offsetHeight : y + 14;
  dicaMapa.style.transform = `translate(${px}px, ${py}px)`;
};

const menuCandidato = document.getElementById("menu-candidato")!;

function escolherModo(novo: Modo) {
  modo = novo;
  document.querySelectorAll("[data-modo]").forEach((o) => o.setAttribute("aria-selected", String((o as HTMLElement).dataset.modo === novo)));
  renderLegenda();
  pintarMapa();
}

document.querySelectorAll<HTMLButtonElement>("[data-candidato]").forEach((b) =>
  b.addEventListener("click", () => {
    candidato = b.dataset.candidato as Numero;
    menuCandidato.hidden = true;
    escolherModo("candidato");
  }),
);
document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest(".abas")) menuCandidato.hidden = true;
});

document.querySelectorAll<HTMLButtonElement>("[data-modo]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.modo === "candidato") {
      menuCandidato.hidden = !menuCandidato.hidden;
      const r = b.getBoundingClientRect(), base = b.closest(".mapa-bloco")!.getBoundingClientRect();
      menuCandidato.style.left = `${r.left - base.left}px`;
      menuCandidato.style.top = `${r.bottom - base.top + 6}px`;
      return;
    }
    escolherModo(b.dataset.modo as Modo);
  }),
);
document.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((b) =>
  b.addEventListener("click", () => mapa.zoomPor(b.dataset.zoom === "in" ? 2 : 0.5)),
);

let itensBusca: Item[] = [];
montarBusca(
  () => {
    if (!itensBusca.length) {
      // Monta a lista uma vez: estados primeiro, depois os municípios (o exterior fica de fora)
      const estados = Object.entries(NOMES_UF)
        .filter(([uf]) => uf !== "zz")
        .map(([uf, nome]) => ({ codigo: `uf:${uf}`, nome, detalhe: "Estado", peso: Infinity }));
      const municipios = Object.entries(primeiro.municipios)
        .filter(([codigo]) => !codigo.startsWith("zz"))
        .map(([codigo, m]) => ({ codigo, nome: nomeProprio(m.nome), detalhe: m.uf.toUpperCase(), peso: m.eleitores }));
      itensBusca = [...estados, ...municipios];
    }
    return itensBusca;
  },
  (item) => {
    mapa.focar(item.codigo);
    selecionado = item.codigo;
    renderDetalhe();
  },
);

function avisar(texto: string) {
  el.aviso.textContent = texto;
  el.aviso.hidden = false;
  setTimeout(() => (el.aviso.hidden = true), 2500);
}

document.getElementById("compartilhar")!.addEventListener("click", async () => {
  const dados = { title: document.title, url: location.href };
  if (navigator.share) {
    await navigator.share(dados).catch(() => {});
  } else {
    await navigator.clipboard.writeText(location.href);
    avisar("Link copiado");
  }
});

const botaoTelaCheia = document.getElementById("tela-cheia")!;
botaoTelaCheia.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});
document.addEventListener("fullscreenchange", () => {
  botaoTelaCheia.querySelector("span")!.textContent = document.fullscreenElement ? "Sair da tela cheia" : "Tela cheia";
});

async function atualizar() {
  const novo = await carregar(URL_2T);
  if (novo) {
    segundo = novo;
    renderTudo();
  }
}

async function iniciar() {
  const [p] = await Promise.all([carregar(URL_1T), mapa.carregar(`${BASE}dados/malha.topo.json`)]);
  if (!p) {
    el.status.textContent = "Não foi possível carregar os dados.";
    return;
  }
  primeiro = p;
  segundo = await carregar(URL_2T);
  renderTudo();
  setInterval(atualizar, INTERVALO_MS);
  // Contagem regressiva no cabeçalho enquanto o 2º turno não começa
  setInterval(() => !segundo && renderStatus(), 1000);
}

iniciar();

import "./estilo.css";
import { CANDIDATOS, REGIOES, carregar, fatiaLula, fmt, pctSecoes, somar, type Estado, type Votos } from "./dados";
import { Mapa } from "./mapa";

type Modo = "resultado" | "mudanca";

const BASE = import.meta.env.BASE_URL;
const URL_1T = `${BASE}dados/1t.json`;
const URL_2T = `${BASE}dados/2t/agora.json`;
const INTERVALO_MS = 30_000;

const el = {
  status: document.getElementById("status")!,
  turno: document.getElementById("turno")!,
  placar: document.getElementById("placar")!,
  legenda: document.getElementById("legenda")!,
  detalhe: document.getElementById("detalhe")!,
  regioes: document.getElementById("regioes")!,
};

let primeiro: Estado;
let segundo: Estado | null = null;
let modo: Modo = "resultado";
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

/** Quem lidera: cor do líder, mais forte quanto maior a vantagem (saturando em 40 pontos) */
function corResultado(v: Votos): string | null {
  const f = fatiaLula(v);
  if (f === null) return null;
  const vantagem = Math.abs(f - 0.5) * 2;
  return misturar(NEUTRO, f >= 0.5 ? LULA : FLAVIO, 0.25 + vantagem / 0.4 * 0.75);
}

/** Mudança: para que lado a fatia do confronto direto andou desde o 1º turno (saturando em 15 pontos) */
function corMudanca(agora: Votos, antes: Votos | undefined): string | null {
  const f2 = fatiaLula(agora);
  const f1 = antes && fatiaLula(antes);
  if (f2 == null || f1 == null) return null;
  const delta = f2 - f1;
  return misturar(NEUTRO, delta >= 0 ? LULA : FLAVIO, Math.abs(delta) / 0.15);
}

function pintor(codigo: string) {
  const agora = atual().municipios[codigo];
  if (!agora) return null;
  if (modo === "resultado") return corResultado(agora);
  return segundo ? corMudanca(agora, primeiro.municipios[codigo]) : null;
}

// ---------- renderização ----------

function renderStatus() {
  if (segundo) {
    const pct = pctSecoes(segundo.br);
    el.status.textContent = `${fmt.pct(pct / 100)} das seções apuradas${segundo.gerado ? ` · atualizado às ${segundo.gerado.slice(-8, -3)}` : ""}`;
    el.turno.textContent = "2º turno · 25 de outubro";
  } else {
    el.status.textContent = "A apuração do 2º turno começa domingo, às 17h. Até lá, o mapa mostra o resultado final do 1º turno.";
    el.turno.textContent = "1º turno · resultado final";
  }
}

function renderPlacar() {
  const br = atual().br;
  const lado = (n: "13" | "22") => {
    const c = CANDIDATOS[n];
    const pct = br.validos ? br[n] / br.validos : 0;
    return `<div class="cand cand-${n}">
      <span class="cand-nome">${c.nome} <small>${c.partido} ${n}</small></span>
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
  el.legenda.innerHTML = modo === "resultado"
    ? `<span><i class="ponto cor-13"></i>Lula</span><span><i class="ponto cor-22"></i>Flávio</span><span class="nota">cor mais forte = vantagem maior</span>`
    : segundo
      ? `<span><i class="ponto cor-13"></i>Lula ganhou terreno</span><span><i class="ponto cor-22"></i>Flávio ganhou terreno</span>`
      : `<span class="nota">Disponível quando a apuração do 2º turno começar.</span>`;
}

function linhaCandidatos(v: Votos) {
  return (["13", "22"] as const)
    .map((n) => `<div class="linha"><span><i class="ponto cor-${n}"></i>${CANDIDATOS[n].nome}</span><b>${v.validos ? fmt.pct(v[n] / v.validos) : "—"}</b><small>${fmt.num(v[n])}</small></div>`)
    .join("");
}

function renderDetalhe() {
  const m = selecionado ? atual().municipios[selecionado] : null;
  if (!m) {
    el.detalhe.hidden = true;
    return;
  }
  const antes = primeiro.municipios[selecionado!];
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
    <h3>${m.nome} <small>${m.uf.toUpperCase()}</small></h3>
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
        <div class="regiao-topo"><span>${nome}</span>${lider ? `<b class="cor-${lider}">${CANDIDATOS[lider].nome} ${fmt.pct1(v[lider] / v.validos)}</b>` : "<b>—</b>"}</div>
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
  mapa.pintar(pintor);
}

// ---------- início ----------

const mapa = new Mapa(document.getElementById("mapa")!);
mapa.onSelecionar = (codigo) => {
  selecionado = codigo;
  renderDetalhe();
};

document.querySelectorAll<HTMLButtonElement>("[data-modo]").forEach((b) =>
  b.addEventListener("click", () => {
    modo = b.dataset.modo as Modo;
    document.querySelectorAll("[data-modo]").forEach((o) => o.setAttribute("aria-selected", String(o === b)));
    renderLegenda();
    mapa.pintar(pintor);
  }),
);
document.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((b) =>
  b.addEventListener("click", () => mapa.zoomPor(b.dataset.zoom === "in" ? 2 : 0.5)),
);

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
}

iniciar();

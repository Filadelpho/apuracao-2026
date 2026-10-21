// Painéis laterais: regiões, últimas atualizações e curva da apuração

import { CANDIDATOS, NOMES_UF, REGIOES, fatiaLula, fmt, horaCurta, pctSecoes, somar, type Evento, type Ponto, type Votos } from "./dados";

const GLOBO = `<svg class="globo" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg>`;

export function renderRegioes(alvo: HTMLElement, ufs: Record<string, Votos>, aoVivo: boolean) {
  const linhas = Object.entries(REGIOES).map(([nome, siglas]) => {
    const v = somar(siglas.map((s) => ufs[s]).filter(Boolean));
    const f = fatiaLula(v);
    const lider = f == null ? null : f >= 0.5 ? "13" : "22";
    const pct = pctSecoes(v);
    // "faltam" conta eleitores das seções ainda não apuradas
    const faltam = v.eleitores * (1 - pct / 100);
    const sub = aoVivo
      ? pct >= 100 ? "100% apurado" : `${Math.floor(pct)}% · faltam ${fmt.milhoes(faltam).replace(" milhões", " mi")}`
      : "1º turno · final";
    return `<div class="regiao">
      <div class="regiao-info">
        <span class="regiao-nome">${nome === "Exterior" ? GLOBO : ""}${nome}</span>
        <small>${sub}</small>
      </div>
      <div class="regiao-res">
        ${lider ? `<b class="cor-${lider}">${CANDIDATOS[lider].curto} ${fmt.pct1(v[lider] / v.validos)}</b>` : "<b class='nota'>—</b>"}
        <div class="barra fina"><span class="barra-13" style="width:${(f ?? 0.5) * 100}%"></span><span class="barra-22" style="width:${(1 - (f ?? 0.5)) * 100}%"></span><i class="barra-meio"></i></div>
      </div>
    </div>`;
  });
  alvo.innerHTML = `<div class="cartao-topo"><h2>Por região</h2><small>Quem lidera para presidente</small></div>${linhas.join("")}`;
}

const nomeCurto = (n: "13" | "22") => CANDIDATOS[n].curto;
const pctTexto = (x: number) => fmt.pct1(x / 100);

function textoEvento(e: Evento): string {
  const placar = (ev: { "13": number; "22": number }) => {
    const ordem: ("13" | "22")[] = ev["13"] >= ev["22"] ? ["13", "22"] : ["22", "13"];
    return `<span>${ordem.map((n) => `<span class="cor-${n}">${nomeCurto(n)} ${pctTexto(ev[n])}</span>`).join(" · ")}</span>`;
  };
  switch (e.tipo) {
    case "inicio":
      return `<b>Primeiros números</b>${placar(e)}`;
    case "parcial":
      return `<b>+${fmt.num(e.novas)} ${e.novas === 1 ? "seção" : "seções"}</b>${placar(e)}`;
    case "virada":
      return `<b>Virada: <span class="cor-${e.lider}">${CANDIDATOS[e.lider].nome}</span> passa à frente</b><span>com ${pctTexto(e.secoes)} das seções apuradas</span>`;
    case "uf":
      return `<b>${NOMES_UF[e.uf]}: apuração concluída</b>${e.lider ? `<span class="cor-${e.lider}">${nomeCurto(e.lider)} ${pctTexto(e.pct)}</span>` : "<span>empate</span>"}`;
    case "fim":
      return `<b>Apuração concluída no Brasil</b>${e.lider ? `<span class="cor-${e.lider}">${CANDIDATOS[e.lider].nome} ${pctTexto(e.pct)} dos votos válidos</span>` : ""}`;
  }
}

export function renderAtualizacoes(alvo: HTMLElement, eventos: Evento[] | null) {
  const corpo = eventos?.length
    ? `<ol class="eventos">${eventos
        .slice(0, 40)
        .map((e) => `<li class="evento evento-${e.tipo}"><time>${horaCurta(e.hora)}</time><div>${textoEvento(e)}</div></li>`)
        .join("")}</ol>`
    : `<p class="vazio">Os primeiros números saem às 17h.</p>`;
  alvo.innerHTML = `<h2>Últimas atualizações</h2>${corpo}`;
}

/**
 * Curva: % dos votos válidos de cada candidato (eixo y) conforme as seções são apuradas (eixo x).
 * `marcador` destaca um ponto (usado pela linha do tempo).
 */
export function renderCurva(alvo: HTMLElement, historico: Ponto[] | null, marcador?: Ponto) {
  const pontos = (historico ?? []).filter((p) => p.secoes >= 1 && p.validos > 0);
  if (pontos.length < 2) {
    alvo.innerHTML = `<h2>Ao longo da apuração</h2><p class="vazio">A curva começa com 1% das seções apuradas.</p>`;
    return;
  }
  const largura = Math.max(alvo.clientWidth - 40, 240);
  const altura = 180;
  const m = { esq: 30, dir: 52, cima: 10, baixo: 22 };
  const pct = (p: Ponto, n: "13" | "22") => (100 * p[n]) / p.validos;

  // Eixo y simétrico em torno de 50%, com folga
  const desvio = Math.max(4, ...pontos.flatMap((p) => [Math.abs(pct(p, "13") - 50), Math.abs(pct(p, "22") - 50)])) + 1.5;
  const y = (v: number) => m.cima + ((50 + desvio - v) / (2 * desvio)) * (altura - m.cima - m.baixo);
  const x = (s: number) => m.esq + (s / 100) * (largura - m.esq - m.dir);
  const linha = (n: "13" | "22") => pontos.map((p, i) => `${i ? "L" : "M"}${x(p.secoes).toFixed(1)},${y(pct(p, n)).toFixed(1)}`).join("");

  const ultimo = marcador ?? pontos[pontos.length - 1];
  // Rótulos no fim das linhas, afastados um do outro quando os valores estão próximos
  let y13 = y(pct(ultimo, "13")), y22 = y(pct(ultimo, "22"));
  if (Math.abs(y13 - y22) < 14) {
    const meio = (y13 + y22) / 2, sinal = y13 <= y22 ? -1 : 1;
    y13 = meio + sinal * 7;
    y22 = meio - sinal * 7;
  }
  const posicao = { "13": y13, "22": y22 };
  const rotulo = (n: "13" | "22") =>
    `<text class="curva-rotulo cor-${n}" x="${x(ultimo.secoes) + 6}" y="${posicao[n] + 4}">${fmt.pct1(pct(ultimo, n) / 100)}</text>`;
  const marcas = [0, 25, 50, 75, 100]
    .map((s) => `<text class="curva-eixo" x="${x(s)}" y="${altura - 4}" text-anchor="middle">${s}%</text>`)
    .join("");

  alvo.innerHTML = `
    <div class="cartao-topo"><h2>Ao longo da apuração</h2><small>% dos válidos × seções apuradas</small></div>
    <svg class="curva-svg" viewBox="0 0 ${largura} ${altura}" width="${largura}" height="${altura}" role="img"
      aria-label="Evolução da apuração: ${CANDIDATOS["13"].nome} ${fmt.pct1(pct(ultimo, "13") / 100)}, ${CANDIDATOS["22"].nome} ${fmt.pct1(pct(ultimo, "22") / 100)}">
      <line class="curva-50" x1="${m.esq}" x2="${largura - m.dir}" y1="${y(50)}" y2="${y(50)}" />
      <text class="curva-eixo" x="${m.esq - 4}" y="${y(50) + 4}" text-anchor="end">50%</text>
      <path class="curva-linha linha-13" d="${linha("13")}" />
      <path class="curva-linha linha-22" d="${linha("22")}" />
      <line class="curva-agora" x1="${x(ultimo.secoes)}" x2="${x(ultimo.secoes)}" y1="${m.cima}" y2="${altura - m.baixo}" />
      ${rotulo("13")}${rotulo("22")}
      ${marcas}
    </svg>`;
}

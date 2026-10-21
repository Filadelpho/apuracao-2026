// Linha do tempo embaixo do mapa: revê o placar e a curva em qualquer horário da noite

import { horaCurta, type Ponto } from "./dados";

const INICIO_MIN = 17 * 60; // 17h, quando a apuração começa
const FIM_MIN_PADRAO = 23 * 60;

/** "25/10/2026 18:24:00" -> minutos desde a meia-noite (passa de 24h se virar o dia) */
function minutos(hora: string): number {
  const [h, m] = hora.slice(-8, -3).split(":").map(Number);
  const dia = Number(hora.slice(0, 2));
  return (h < 12 && dia > 25 ? 24 * 60 : 0) + h * 60 + m;
}

export class LinhaTempo {
  private faixa: HTMLInputElement;
  private hora: HTMLElement;
  private marcas: HTMLElement;
  private aoVivo: HTMLButtonElement;
  private pontos: Ponto[] = [];
  /** Ponto escolhido; null = acompanhando ao vivo */
  escolhido: Ponto | null = null;

  onMudar: () => void = () => {};

  constructor(raiz: HTMLElement) {
    this.faixa = raiz.querySelector("input")!;
    this.hora = raiz.querySelector(".lt-hora")!;
    this.marcas = raiz.querySelector(".lt-marcas")!;
    this.aoVivo = raiz.querySelector(".lt-vivo")!;

    this.faixa.addEventListener("input", () => {
      const alvo = Number(this.faixa.value);
      // O último ponto até o horário escolhido; perto do fim, volta ao vivo
      const anteriores = this.pontos.filter((p) => minutos(p.hora) <= alvo);
      const ultimo = this.pontos[this.pontos.length - 1];
      this.escolhido = !anteriores.length ? this.pontos[0] : anteriores[anteriores.length - 1] === ultimo ? null : anteriores[anteriores.length - 1];
      this.desenhar();
      this.onMudar();
    });
    this.aoVivo.addEventListener("click", () => {
      this.escolhido = null;
      this.desenhar();
      this.onMudar();
    });
  }

  atualizar(historico: Ponto[] | null) {
    this.pontos = (historico ?? []).filter((p) => p.st > 0);
    this.desenhar();
  }

  private desenhar() {
    const ultimo = this.pontos[this.pontos.length - 1];
    const fim = Math.max(FIM_MIN_PADRAO, ultimo ? Math.ceil(minutos(ultimo.hora) / 60) * 60 : 0);
    this.faixa.min = String(INICIO_MIN);
    this.faixa.max = String(fim);
    this.faixa.disabled = this.pontos.length < 2;

    const atual = this.escolhido ?? ultimo;
    const valor = atual ? minutos(atual.hora) : INICIO_MIN;
    this.faixa.value = String(valor);
    // Parte já apurada da faixa, até o último ponto recebido
    const pct = (m: number) => ((m - INICIO_MIN) / (fim - INICIO_MIN)) * 100;
    this.faixa.style.setProperty("--feito", `${ultimo ? pct(minutos(ultimo.hora)) : 0}%`);
    this.faixa.setAttribute("aria-valuetext", atual ? `${horaCurta(atual.hora)}, ${atual.secoes.toFixed(1)}% das seções` : "apuração não começou");

    this.hora.textContent = atual ? horaCurta(atual.hora) : "17h00";
    this.aoVivo.classList.toggle("ativo", !this.escolhido && !!ultimo);
    this.aoVivo.disabled = !this.escolhido;

    const horas = [];
    for (let m = INICIO_MIN; m <= fim; m += 60) {
      horas.push(`<span style="left:${pct(m)}%">${String((m / 60) % 24).padStart(2, "0")}h</span>`);
    }
    this.marcas.innerHTML = horas.join("");
  }
}

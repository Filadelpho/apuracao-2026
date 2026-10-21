import { geoContains, geoMercator, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { feature, mesh } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { UF_IBGE } from "./dados";

type Forma = {
  codigo: string;
  geo: GeoPermissibleObjects;
  caminho: Path2D;
  caixa: [[number, number], [number, number]];
};

/** Etiqueta fora do mapa para estado pequeno demais para ter a sigla dentro */
type Caixinha = { uf: string; texto: string; x: number; y: number; l: number; a: number; ancora?: [number, number] };

/** Recebe o código IBGE do município e devolve a cor (null = sem dado) */
export type Pintor = (codigo: string) => string | null;
/** Recebe a sigla da UF (ou "zz" para o exterior) e devolve a cor da caixinha */
export type PintorUf = (uf: string) => string | null;

// Estados com etiqueta do lado de fora, de cima para baixo, em dois grupos
const CAIXINHAS = [["rn", "pb", "pe", "al", "se"], ["es", "rj"]];
const ALTURA_CAIXA = 26;
const PASSO_CAIXA = 33;
const X_CAIXA = 872;
const LARGURA_CAIXA = 70;

/**
 * Mapa de municípios em canvas: 5.570 polígonos são leves demais para SVG no celular.
 * Códigos devolvidos em onPassar/onSelecionar: código IBGE do município ou "uf:<sigla>".
 */
export class Mapa {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private formas: Forma[] = [];
  private bordasUf = new Path2D();
  private rotulos: { uf: string; x: number; y: number }[] = [];
  private caixinhas: Caixinha[] = [];
  private transform: ZoomTransform = zoomIdentity;
  private comportamento!: ZoomBehavior<HTMLCanvasElement, unknown>;
  private largura = 0;
  private altura = 0;
  private pintor: Pintor = () => null;
  private pintorUf: PintorUf = () => null;
  private destaque: string | null = null;
  private projecao = geoMercator();
  private cores = { vazio: "", borda: "", bordaUf: "", destaque: "", texto2: "", linha: "" };

  onSelecionar: (codigo: string | null) => void = () => {};
  /** Mouse sobre o mapa (x, y relativos ao recipiente); null ao sair */
  onPassar: (codigo: string | null, x: number, y: number) => void = () => {};

  constructor(private recipiente: HTMLElement) {
    this.canvas = recipiente.querySelector("canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
  }

  async carregar(url: string) {
    const topo = (await (await fetch(url)).json()) as Topology<{
      municipios: GeometryCollection<{ codarea: string }>;
      ufs: GeometryCollection<{ uf: string }>;
    }>;
    const municipios = feature(topo, topo.objects.municipios);
    // A faixa da direita do quadro fica livre para as caixinhas dos estados pequenos
    this.projecao.fitExtent([[10, 10], [850, 990]], municipios);
    const caminho = geoPath(this.projecao);

    this.formas = municipios.features.map((f) => ({
      codigo: String(f.properties!.codarea),
      geo: f,
      caminho: new Path2D(caminho(f) ?? ""),
      caixa: caminho.bounds(f),
    }));
    this.bordasUf = new Path2D(caminho(mesh(topo, topo.objects.ufs)) ?? "");
    this.montarRotulos(feature(topo, topo.objects.ufs).features, caminho);

    this.comportamento = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, 40])
      // Toque com um dedo fica para a rolagem da página
      .filter((e) => !e.button && (!e.touches || e.touches.length > 1))
      .on("zoom", (e) => {
        this.transform = e.transform;
        this.desenhar();
      });
    select(this.canvas).call(this.comportamento);

    this.canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const codigo = this.codigoEm(e);
      this.canvas.style.cursor = codigo ? "pointer" : "";
      if (codigo !== this.destaque) {
        this.destaque = codigo;
        this.desenhar();
      }
      const r = this.canvas.getBoundingClientRect();
      this.onPassar(codigo, e.clientX - r.left, e.clientY - r.top);
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.destaque = null;
      this.desenhar();
      this.onPassar(null, 0, 0);
    });
    this.canvas.addEventListener("click", (e) => this.onSelecionar(this.codigoEm(e)));

    new ResizeObserver(() => this.redimensionar()).observe(this.recipiente);
    this.redimensionar();
  }

  zoomPor(fator: number) {
    select(this.canvas).call(this.comportamento.scaleBy, fator);
  }

  /** Aproxima um município (código IBGE) ou um estado ("uf:<sigla>") e o destaca */
  focar(codigo: string) {
    const ibgeUf = codigo.startsWith("uf:") ? Object.keys(UF_IBGE).find((k) => UF_IBGE[k] === codigo.slice(3)) : null;
    const alvo = this.formas.filter((f) => (ibgeUf ? f.codigo.startsWith(ibgeUf) : f.codigo === codigo));
    if (!alvo.length) return;
    const x0 = Math.min(...alvo.map((f) => f.caixa[0][0])), y0 = Math.min(...alvo.map((f) => f.caixa[0][1]));
    const x1 = Math.max(...alvo.map((f) => f.caixa[1][0])), y1 = Math.max(...alvo.map((f) => f.caixa[1][1]));

    const { escala, dx, dy } = this.base();
    const largura = Math.max((x1 - x0) * escala, 1), altura = Math.max((y1 - y0) * escala, 1);
    const k = Math.min(12, Math.max(1, 0.45 * Math.min(this.largura / largura, this.altura / altura)));
    const cx = dx + ((x0 + x1) / 2) * escala, cy = dy + ((y0 + y1) / 2) * escala;
    const t = zoomIdentity.translate(this.largura / 2, this.altura / 2).scale(k).translate(-cx, -cy);
    this.destaque = ibgeUf ? null : codigo;
    select(this.canvas).call(this.comportamento.transform, t);
  }

  pintar(pintor: Pintor, pintorUf: PintorUf) {
    this.pintor = pintor;
    this.pintorUf = pintorUf;
    this.desenhar();
  }

  private montarRotulos(ufs: GeoJSON.Feature<GeoJSON.Geometry, { uf: string }>[], caminho: ReturnType<typeof geoPath>) {
    const centros = new Map<string, [number, number]>();
    for (const f of ufs) centros.set(UF_IBGE[f.properties.uf], caminho.centroid(f));

    const deFora = new Set(CAIXINHAS.flat());
    this.rotulos = [...centros].filter(([uf]) => !deFora.has(uf)).map(([uf, [x, y]]) => ({ uf, x, y }));

    this.caixinhas = [];
    for (const grupo of CAIXINHAS) {
      // O grupo começa na altura do primeiro estado, para as linhas saírem quase retas
      let y = centros.get(grupo[0])![1] - ALTURA_CAIXA / 2 - 6;
      for (const uf of grupo) {
        this.caixinhas.push({ uf, texto: uf.toUpperCase(), x: X_CAIXA, y, l: LARGURA_CAIXA, a: ALTURA_CAIXA, ancora: centros.get(uf) });
        y += PASSO_CAIXA;
      }
    }
    const ultima = this.caixinhas[this.caixinhas.length - 1];
    this.caixinhas.push({ uf: "zz", texto: "Exterior", x: X_CAIXA, y: ultima.y + PASSO_CAIXA + 10, l: LARGURA_CAIXA, a: ALTURA_CAIXA });
  }

  private redimensionar() {
    const dpr = window.devicePixelRatio || 1;
    this.largura = this.recipiente.clientWidth;
    this.altura = this.recipiente.clientHeight;
    this.canvas.width = Math.round(this.largura * dpr);
    this.canvas.height = Math.round(this.altura * dpr);
    this.comportamento.extent([[0, 0], [this.largura, this.altura]]).translateExtent([[-200, -200], [this.largura + 200, this.altura + 200]]);
    const css = getComputedStyle(document.documentElement);
    const v = (nome: string) => css.getPropertyValue(nome).trim();
    this.cores = {
      vazio: v("--mapa-vazio"),
      borda: v("--mapa-borda"),
      bordaUf: v("--mapa-borda-uf"),
      destaque: v("--texto"),
      texto2: v("--texto-2"),
      linha: v("--linha"),
    };
    this.desenhar();
  }

  /** Escala que encaixa o quadro de 1000×1000 da projeção no recipiente */
  private base() {
    const escala = Math.min(this.largura, this.altura) / 1000;
    return { escala, dx: (this.largura - 1000 * escala) / 2, dy: (this.altura - 1000 * escala) / 2 };
  }

  private desenhar() {
    if (!this.formas.length) return;
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const { escala, dx, dy } = this.base();
    const k = this.transform.k * escala;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (this.transform.x + dx * this.transform.k), dpr * (this.transform.y + dy * this.transform.k));

    ctx.lineJoin = "round";
    ctx.lineWidth = 0.4 / k;
    ctx.strokeStyle = this.cores.borda;
    for (const f of this.formas) {
      ctx.fillStyle = this.pintor(f.codigo) ?? this.cores.vazio;
      ctx.fill(f.caminho);
      // Bordas municipais só aparecem quando há espaço para elas
      if (this.transform.k > 2.5) ctx.stroke(f.caminho);
    }

    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = this.cores.bordaUf;
    ctx.stroke(this.bordasUf);

    const marcado = this.destaque && this.formas.find((f) => f.codigo === this.destaque);
    if (marcado) {
      ctx.lineWidth = 2 / k;
      ctx.strokeStyle = this.cores.destaque;
      ctx.stroke(marcado.caminho);
    }

    this.desenharRotulos(k);
  }

  private desenharRotulos(k: number) {
    const { ctx } = this;
    // Texto com tamanho fixo na tela, qualquer que seja o zoom
    const fonte = (px: number, peso = 600) => `${peso} ${px / k}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    ctx.font = fonte(11);
    for (const r of this.rotulos) {
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.strokeText(r.uf.toUpperCase(), r.x, r.y);
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.fillText(r.uf.toUpperCase(), r.x, r.y);
    }

    // As caixinhas acompanham o mapa, mas o tamanho fica fixo na tela
    const s = 1 / this.transform.k;
    for (const c of this.caixinhas) {
      const l = c.l * s, a = c.a * s;
      if (c.ancora) {
        ctx.beginPath();
        ctx.moveTo(c.ancora[0], c.ancora[1]);
        ctx.lineTo(c.x, c.y + a / 2);
        ctx.lineWidth = 1 / k;
        ctx.strokeStyle = this.cores.texto2;
        ctx.stroke();
      }
      const cor = this.pintorUf(c.uf);
      ctx.beginPath();
      ctx.roundRect(c.x, c.y, l, a, 6 * s);
      ctx.fillStyle = cor ?? this.cores.vazio;
      ctx.fill();
      if (this.destaque === `uf:${c.uf}`) {
        ctx.lineWidth = 2 / k;
        ctx.strokeStyle = this.cores.destaque;
        ctx.stroke();
      }
      ctx.font = fonte(c.uf === "zz" ? 11 : 12);
      ctx.fillStyle = cor ? "rgba(255, 255, 255, 0.95)" : this.cores.texto2;
      ctx.fillText(c.texto, c.x + l / 2, c.y + a / 2 + 0.5 / k);
    }
  }

  private codigoEm(e: MouseEvent): string | null {
    const r = this.canvas.getBoundingClientRect();
    const { escala, dx, dy } = this.base();
    const [tx, ty] = this.transform.invert([e.clientX - r.left, e.clientY - r.top]);
    const x = (tx - dx) / escala;
    const y = (ty - dy) / escala;

    const s = 1 / this.transform.k;
    for (const c of this.caixinhas) {
      if (x >= c.x && x <= c.x + c.l * s && y >= c.y && y <= c.y + c.a * s) return `uf:${c.uf}`;
    }

    const ponto = this.projecao.invert!([x, y]);
    if (!ponto) return null;
    for (const f of this.formas) {
      const [[x0, y0], [x1, y1]] = f.caixa;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (geoContains(f.geo, ponto)) return f.codigo;
    }
    return null;
  }
}

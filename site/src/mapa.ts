import { geoContains, geoMercator, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { feature, mesh } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";

type Forma = {
  codigo: string;
  geo: GeoPermissibleObjects;
  caminho: Path2D;
  caixa: [[number, number], [number, number]];
};

export type Pintor = (codigo: string) => string | null;

/** Mapa de municípios em canvas: 5.570 polígonos são leves demais para SVG no celular. */
export class Mapa {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private formas: Forma[] = [];
  private bordasUf = new Path2D();
  private transform: ZoomTransform = zoomIdentity;
  private comportamento!: ZoomBehavior<HTMLCanvasElement, unknown>;
  private largura = 0;
  private altura = 0;
  private pintor: Pintor = () => null;
  private destaque: string | null = null;
  private projecao = geoMercator();
  private cores = { vazio: "", borda: "", bordaUf: "", destaque: "" };

  onSelecionar: (codigo: string | null) => void = () => {};

  constructor(private recipiente: HTMLElement) {
    this.canvas = recipiente.querySelector("canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
  }

  async carregar(url: string) {
    const topo = (await (await fetch(url)).json()) as Topology<{
      municipios: GeometryCollection<{ codarea: string }>;
      ufs: GeometryCollection;
    }>;
    const municipios = feature(topo, topo.objects.municipios);
    this.projecao.fitSize([1000, 1000], municipios);
    const caminho = geoPath(this.projecao);

    this.formas = municipios.features.map((f) => ({
      codigo: String(f.properties!.codarea),
      geo: f,
      caminho: new Path2D(caminho(f) ?? ""),
      caixa: caminho.bounds(f),
    }));
    this.bordasUf = new Path2D(caminho(mesh(topo, topo.objects.ufs)) ?? "");

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
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.destaque = null;
      this.desenhar();
    });
    this.canvas.addEventListener("click", (e) => this.onSelecionar(this.codigoEm(e)));

    new ResizeObserver(() => this.redimensionar()).observe(this.recipiente);
    this.redimensionar();
  }

  zoomPor(fator: number) {
    select(this.canvas).call(this.comportamento.scaleBy, fator);
  }

  pintar(pintor: Pintor) {
    this.pintor = pintor;
    this.desenhar();
  }

  private redimensionar() {
    const dpr = window.devicePixelRatio || 1;
    this.largura = this.recipiente.clientWidth;
    this.altura = this.recipiente.clientHeight;
    this.canvas.width = Math.round(this.largura * dpr);
    this.canvas.height = Math.round(this.altura * dpr);
    this.comportamento.extent([[0, 0], [this.largura, this.altura]]).translateExtent([[-200, -200], [this.largura + 200, this.altura + 200]]);
    const css = getComputedStyle(document.documentElement);
    this.cores = {
      vazio: css.getPropertyValue("--mapa-vazio").trim(),
      borda: css.getPropertyValue("--mapa-borda").trim(),
      bordaUf: css.getPropertyValue("--mapa-borda-uf").trim(),
      destaque: css.getPropertyValue("--texto").trim(),
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
  }

  private codigoEm(e: MouseEvent): string | null {
    const r = this.canvas.getBoundingClientRect();
    const { escala, dx, dy } = this.base();
    const [tx, ty] = this.transform.invert([e.clientX - r.left, e.clientY - r.top]);
    const x = (tx - dx) / escala;
    const y = (ty - dy) / escala;
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

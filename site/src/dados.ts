// Formato enxuto gerado pelo coletor (coletor/preparar_base.py e coletor/coletar.py)

export type Votos = {
  "13": number;
  "22": number;
  outros: number;
  validos: number;
  eleitores: number;
  /** Eleitores das seções já apuradas; ausente nos dados finais do 1º turno (= eleitores) */
  apurados?: number;
  comparecimento: number;
  /** % de seções apuradas; ausente nos dados finais do 1º turno */
  secoes?: number;
};

/** Comparecimento entre os eleitores das seções já apuradas */
export function taxaComparecimento(v: Votos): number | null {
  const base = v.apurados ?? v.eleitores;
  return base ? v.comparecimento / base : null;
}

export type Municipio = Votos & { uf: string; nome: string };

export type Estado = {
  gerado?: string;
  br: Votos;
  ufs: Record<string, Votos>;
  municipios: Record<string, Municipio>;
};

export const CANDIDATOS = {
  "13": { nome: "Lula", curto: "Lula", partido: "PT", cor: "var(--lula)" },
  "22": { nome: "Flávio Bolsonaro", curto: "Flávio", partido: "PL", cor: "var(--flavio)" },
} as const;

export const REGIOES: Record<string, string[]> = {
  Norte: ["ac", "am", "ap", "pa", "ro", "rr", "to"],
  Nordeste: ["al", "ba", "ce", "ma", "pb", "pe", "pi", "rn", "se"],
  "Centro-Oeste": ["df", "go", "ms", "mt"],
  Sudeste: ["es", "mg", "rj", "sp"],
  Sul: ["pr", "rs", "sc"],
  Exterior: ["zz"],
};

export const NOMES_UF: Record<string, string> = {
  ac: "Acre", al: "Alagoas", am: "Amazonas", ap: "Amapá", ba: "Bahia", ce: "Ceará", df: "Distrito Federal",
  es: "Espírito Santo", go: "Goiás", ma: "Maranhão", mg: "Minas Gerais", ms: "Mato Grosso do Sul",
  mt: "Mato Grosso", pa: "Pará", pb: "Paraíba", pe: "Pernambuco", pi: "Piauí", pr: "Paraná",
  rj: "Rio de Janeiro", rn: "Rio Grande do Norte", ro: "Rondônia", rr: "Roraima", rs: "Rio Grande do Sul",
  sc: "Santa Catarina", se: "Sergipe", sp: "São Paulo", to: "Tocantins", zz: "Exterior",
};

// Código IBGE da UF (dois primeiros dígitos do município) para a sigla
export const UF_IBGE: Record<string, string> = {
  "11": "ro", "12": "ac", "13": "am", "14": "rr", "15": "pa", "16": "ap", "17": "to",
  "21": "ma", "22": "pi", "23": "ce", "24": "rn", "25": "pb", "26": "pe", "27": "al", "28": "se", "29": "ba",
  "31": "mg", "32": "es", "33": "rj", "35": "sp", "41": "pr", "42": "sc", "43": "rs",
  "50": "ms", "51": "mt", "52": "go", "53": "df",
};

export function pctSecoes(v: Votos): number {
  return v.secoes ?? 100;
}

/** Fatia de Lula no confronto direto (só votos dos dois), de 0 a 1; null sem votos */
export function fatiaLula(v: Votos): number | null {
  const soma = v["13"] + v["22"];
  return soma > 0 ? v["13"] / soma : null;
}

export function somar(lista: Votos[]): Votos {
  const total: Votos = { "13": 0, "22": 0, outros: 0, validos: 0, eleitores: 0, comparecimento: 0 };
  let secoesPonderadas = 0;
  for (const v of lista) {
    total["13"] += v["13"];
    total["22"] += v["22"];
    total.outros += v.outros;
    total.validos += v.validos;
    total.eleitores += v.eleitores;
    total.apurados = (total.apurados ?? 0) + (v.apurados ?? v.eleitores);
    total.comparecimento += v.comparecimento;
    secoesPonderadas += pctSecoes(v) * v.eleitores;
  }
  total.secoes = total.eleitores ? secoesPonderadas / total.eleitores : 0;
  return total;
}

/** Um ponto da curva: o Brasil a cada atualização (historico.json) */
export type Ponto = { hora: string; secoes: number; st: number; "13": number; "22": number; validos: number };

/** Uma linha de "Últimas atualizações" (eventos.json), mais recente primeiro */
export type Evento =
  | { hora: string; tipo: "inicio"; "13": number; "22": number }
  | { hora: string; tipo: "parcial"; novas: number; "13": number; "22": number }
  | { hora: string; tipo: "virada"; lider: "13" | "22"; secoes: number }
  | { hora: string; tipo: "uf"; uf: string; lider: "13" | "22" | null; pct: number }
  | { hora: string; tipo: "fim"; lider: "13" | "22" | null; pct: number };

export async function carregar<T = Estado>(url: string): Promise<T | null> {
  try {
    const resp = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

/** "25/10/2026 18:24:00" -> "18h24" */
export const horaCurta = (hora: string) => hora.slice(-8, -3).replace(":", "h");

const nf = new Intl.NumberFormat("pt-BR");
const pf = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmt = {
  num: (n: number) => nf.format(n),
  pct: (x: number) => pf.format(x * 100) + "%",
  pct1: (x: number) => pf1.format(x * 100) + "%",
  pontos: (x: number) => pf1.format(Math.abs(x) * 100) + " pontos",
  milhoes: (n: number) =>
    n >= 1e6 ? pf1.format(n / 1e6) + (n < 2e6 ? " milhão" : " milhões") : n >= 1e3 ? nf.format(Math.round(n / 1e3)) + " mil" : nf.format(n),
  /** "2,2 milhões de votos", "77 mil votos", "1 voto" */
  votos: (n: number) => {
    const texto = fmt.milhoes(n);
    return texto.endsWith("ão") || texto.endsWith("ões") ? `${texto} de votos` : `${texto} ${n === 1 ? "voto" : "votos"}`;
  },
};

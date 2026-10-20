"""Cliente do feed público de resultados do TSE (resultados.tse.jus.br).

Os arquivos de 2026 são JWS: três partes em base64url separadas por ponto
(cabeçalho, conteúdo JSON e assinatura EdDSA do TSE). Aqui só lemos o
conteúdo; a verificação da assinatura fica para depois.
"""

import asyncio
import base64
import json
import time

import httpx

BASE = "https://resultados.tse.jus.br/oficial"
CICLO = "ele2026"
CARGO_PRESIDENTE = 1

# Códigos das eleições de presidente, tirados de comum/config/ele-c.jws
ELEICOES = {
    "1t": "6257",
    "2t": "6258",
}

UFS = [
    "ac", "al", "am", "ap", "ba", "ce", "df", "es", "go", "ma", "mg", "ms",
    "mt", "pa", "pb", "pe", "pi", "pr", "rj", "rn", "ro", "rr", "rs", "sc",
    "se", "sp", "to",
]
EXTERIOR = "zz"

REGIOES = {
    "Norte": ["ac", "am", "ap", "pa", "ro", "rr", "to"],
    "Nordeste": ["al", "ba", "ce", "ma", "pb", "pe", "pi", "rn", "se"],
    "Centro-Oeste": ["df", "go", "ms", "mt"],
    "Sudeste": ["es", "mg", "rj", "sp"],
    "Sul": ["pr", "rs", "sc"],
}


def _e(ele: str) -> str:
    return f"e{int(ele):06d}"


def _c(cargo: int) -> str:
    return f"c{cargo:04d}"


def url_resultado(ele: str, uf: str = "br", municipio: str = "") -> str:
    """Resultado de um cargo no Brasil, numa UF ou num município (código TSE)."""
    return f"{BASE}/{CICLO}/{ele}/dados/{uf}/{uf}{municipio}-{_c(CARGO_PRESIDENTE)}-{_e(ele)}-u.jws"


def url_acompanhamento(ele: str, uf: str = "br") -> str:
    """Andamento da totalização: por UF (uf='br') ou por município de uma UF."""
    return f"{BASE}/{CICLO}/{ele}/dados/{uf}/{uf}-{_e(ele)}-ab.jws"


def url_municipios(ele: str) -> str:
    """Lista de municípios com código TSE, código IBGE e nome."""
    return f"{BASE}/{CICLO}/{ele}/config/mun-{_e(ele)}-cm.jws"


def decodificar_jws(texto: str) -> dict:
    conteudo = texto.strip().split(".")[1]
    conteudo += "=" * (-len(conteudo) % 4)
    return json.loads(base64.urlsafe_b64decode(conteudo))


def _int(valor) -> int:
    return int(valor or 0)


def _pct(valor) -> float:
    # O TSE manda percentuais como texto com vírgula: "47,027772356"
    return float(str(valor or "0").replace(",", "."))


def candidatos(payload: dict) -> list[dict]:
    """Achata cargo > agremiação > partido > candidato numa lista simples."""
    lista = []
    for cargo in payload.get("carg", []):
        for agr in cargo.get("agr", []):
            for par in agr.get("par", []):
                for cand in par.get("cand", []):
                    lista.append({
                        "n": cand["n"],
                        "nome": cand.get("nmu") or cand["nm"],
                        "partido": par["sg"],
                        "votos": _int(cand.get("vap")),
                        "pct": _pct(cand.get("pvapn")),
                    })
    lista.sort(key=lambda c: c["votos"], reverse=True)
    return lista


def resumir(payload: dict) -> dict:
    """Versão enxuta de um arquivo de resultado (-u), para o site e o arquivo histórico."""
    s, e, v = payload.get("s", {}), payload.get("e", {}), payload.get("v", {})
    return {
        "abr": payload.get("cdabr"),
        "gerado": f"{payload.get('dg')} {payload.get('hg')}",
        "totalizado": f"{payload.get('dt')} {payload.get('ht')}".strip(),
        "andamento": payload.get("and"),
        "secoes": {"total": _int(s.get("ts")), "apuradas": _int(s.get("st")), "pct": _pct(s.get("pstn"))},
        "eleitores": _int(e.get("te")),
        "comparecimento": _int(e.get("c")),
        "abstencao": _int(e.get("a")),
        "validos": _int(v.get("vv")),
        "brancos": _int(v.get("vb")),
        "nulos": _int(v.get("tvn")),
        "candidatos": candidatos(payload),
    }


PRINCIPAIS = ["13", "22"]


def enxuto(resumo: dict) -> dict:
    """Formato que o site lê: só os dois do 2º turno, o resto agregado em 'outros'."""
    votos = {c["n"]: c["votos"] for c in resumo["candidatos"]}
    principais = {n: votos.get(n, 0) for n in PRINCIPAIS}
    return {
        **principais,
        "outros": resumo["validos"] - sum(principais.values()),
        "validos": resumo["validos"],
        "eleitores": resumo["eleitores"],
        "comparecimento": resumo["comparecimento"],
        "secoes": resumo["secoes"]["pct"],
    }


class ClienteTSE:
    """Baixa arquivos do TSE com limite de requisições simultâneas e novas tentativas."""

    def __init__(self, simultaneas: int = 8, tentativas: int = 4):
        self._limite = asyncio.Semaphore(simultaneas)
        self._tentativas = tentativas
        self._http = httpx.AsyncClient(
            timeout=20,
            headers={"User-Agent": "apuracao-pt/0.1 (projeto de portfolio; coleta educada)"},
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *erro):
        await self._http.aclose()

    async def baixar(self, url: str) -> tuple[str, dict] | None:
        """Devolve (texto JWS bruto, conteúdo decodificado), ou None se o arquivo não existe."""
        for tentativa in range(self._tentativas):
            try:
                async with self._limite:
                    # nocache força a CDN do TSE a entregar a versão mais nova, como o app oficial faz
                    resp = await self._http.get(url, params={"nocache": int(time.time() * 1000)})
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()
                return resp.text, decodificar_jws(resp.text)
            except (httpx.HTTPError, ValueError):
                if tentativa == self._tentativas - 1:
                    raise
                await asyncio.sleep(1.5 * (tentativa + 1))
        return None

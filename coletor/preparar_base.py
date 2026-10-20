"""Baixa o resultado final do 1º turno (presidente) por município e a malha do IBGE.

Gera:
  dados/base/1t_municipios.json   resultado completo por município (para a análise)
  site/public/dados/1t.json       versão enxuta para o mapa
  dados/base/malha_municipios.geojson  malha municipal do IBGE (vira TopoJSON no site)

Uso: coletor\\.venv\\Scripts\\python.exe coletor\\preparar_base.py
"""

import asyncio
import json
from pathlib import Path

import httpx

import tse

RAIZ = Path(__file__).resolve().parent.parent
BASE = RAIZ / "dados" / "base"
SITE = RAIZ / "site" / "public" / "dados"

MALHA_IBGE = (
    "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR"
    "?formato=application/vnd.geo+json&qualidade=intermediaria&intrarregiao=municipio"
)

enxuto = tse.enxuto


async def main():
    BASE.mkdir(parents=True, exist_ok=True)
    SITE.mkdir(parents=True, exist_ok=True)
    ele = tse.ELEICOES["1t"]

    async with tse.ClienteTSE(simultaneas=8) as cliente:
        _, config = await cliente.baixar(tse.url_municipios(ele))
        lista = [
            {"uf": abr["cd"], "tse": mu["cd"], "ibge": mu.get("cdi") or "", "nome": mu["nm"]}
            for abr in config["abr"]
            for mu in abr["mu"]
        ]
        print(f"{len(lista)} municípios/cidades no exterior na lista do TSE")

        _, br = await cliente.baixar(tse.url_resultado(ele))
        ufs = await asyncio.gather(*(cliente.baixar(tse.url_resultado(ele, uf)) for uf in tse.UFS + [tse.EXTERIOR]))

        feitos = 0

        async def municipio(m):
            nonlocal feitos
            r = await cliente.baixar(tse.url_resultado(ele, m["uf"], m["tse"]))
            feitos += 1
            if feitos % 500 == 0:
                print(f"  {feitos}/{len(lista)}")
            return m, (tse.resumir(r[1]) if r else None)

        resultados = await asyncio.gather(*(municipio(m) for m in lista))

    faltando = [m for m, r in resultados if r is None]
    if faltando:
        print(f"Aviso: {len(faltando)} sem arquivo de resultado, ex.: {faltando[:3]}")

    completo = {
        "br": tse.resumir(br),
        "ufs": {uf: tse.resumir(r[1]) for uf, r in zip(tse.UFS + [tse.EXTERIOR], ufs) if r},
        "municipios": [{**m, "resultado": r} for m, r in resultados if r],
    }
    (BASE / "1t_municipios.json").write_text(json.dumps(completo, ensure_ascii=False), encoding="utf-8")

    # A chave do mapa é o código IBGE; cidades no exterior não têm, então usam zz + código TSE
    site = {
        "br": enxuto(completo["br"]),
        "ufs": {uf: enxuto(r) for uf, r in completo["ufs"].items()},
        "municipios": {
            (m["ibge"] or f"zz{m['tse']}"): {"uf": m["uf"], "nome": m["nome"], **enxuto(m["resultado"])}
            for m in completo["municipios"]
        },
    }
    (SITE / "1t.json").write_text(json.dumps(site, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Resultado do 1º turno salvo ({len(site['municipios'])} áreas)")

    destino = BASE / "malha_municipios.geojson"
    if not destino.exists():
        print("Baixando malha municipal do IBGE...")
        async with httpx.AsyncClient(timeout=120) as http:
            resp = await http.get(MALHA_IBGE)
            resp.raise_for_status()
            destino.write_bytes(resp.content)
        print(f"Malha salva ({destino.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    asyncio.run(main())

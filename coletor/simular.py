"""Simula a apuração do 2º turno a partir dos dados reais do 1º, para testar o site.

Os números são inventados: em cada município, os votos de quem ficou de fora no
1º turno são divididos entre Lula e Flávio com um sorteio, e as urnas "chegam" aos
poucos (municípios pequenos primeiro). Serve para ver o site funcionando ao vivo
antes de domingo; os arquivos são escritos onde o site lê o 2º turno.

Uso:
  coletor\\.venv\\Scripts\\python.exe coletor\\simular.py                 # 90 passos, 1 a cada 2 s
  coletor\\.venv\\Scripts\\python.exe coletor\\simular.py --passos 40 --intervalo 0
  coletor\\.venv\\Scripts\\python.exe coletor\\simular.py --intervalo 0 --ate 0.4  # para no meio da noite
  coletor\\.venv\\Scripts\\python.exe coletor\\simular.py --limpar         # apaga a simulação
"""

import argparse
import json
import math
import random
import shutil
import time
from datetime import datetime, timedelta
from pathlib import Path

import tse
from saida import Saida

RAIZ = Path(__file__).resolve().parent.parent
BASE_1T = RAIZ / "dados" / "base" / "1t_municipios.json"
PASTA_2T = RAIZ / "site" / "public" / "dados" / "2t"

INICIO = datetime(2026, 10, 25, 17, 0)
DURACAO = timedelta(hours=6)  # do início ao fim da simulação, no relógio simulado
SECOES_POR_ELEITOR = 1 / 318  # média do 1º turno: ~158,7 mi de eleitores em ~499 mil seções


def preparar(sorteio: random.Random) -> list[dict]:
    """Resultado final inventado de cada município e o ritmo em que ele é apurado."""
    base = json.loads(BASE_1T.read_text(encoding="utf-8"))
    municipios = []
    for m in base["municipios"]:
        r = m["resultado"]
        votos = {c["n"]: c["votos"] for c in r["candidatos"]}
        lula, flavio = votos.get("13", 0), votos.get("22", 0)
        outros = r["validos"] - lula - flavio
        # Quanto dos votos dos outros candidatos vai para Lula (o resto vai para Flávio)
        para_lula = min(0.85, max(0.15, sorteio.gauss(0.42, 0.12)))
        final = {"13": lula + round(outros * para_lula), "22": flavio + round(outros * (1 - para_lula))}
        tamanho = math.log10(max(r["eleitores"], 10))
        municipios.append({
            "uf": m["uf"],
            "chave": m["ibge"] or f"zz{m['tse']}",
            "nome": m["nome"],
            "eleitores": r["eleitores"],
            "comparecimento": r["comparecimento"],
            "final": final,
            # Municípios grandes começam e terminam mais tarde; o exterior chega por último
            "inicio": sorteio.uniform(0, 0.12) + 0.03 * tamanho + (0.25 if m["uf"] == tse.EXTERIOR else 0),
            "duracao": sorteio.uniform(0.05, 0.2) + 0.06 * tamanho,
        })
    return municipios


def somar(partes: list[dict]) -> dict:
    total = {"13": 0, "22": 0, "outros": 0, "validos": 0, "eleitores": 0, "apurados": 0, "comparecimento": 0}
    ponderado = 0.0
    for p in partes:
        for k in total:
            total[k] += p[k]
        ponderado += p["secoes"] * p["eleitores"]
    total["secoes"] = round(ponderado / total["eleitores"], 2) if total["eleitores"] else 0.0
    return total


def momento(municipios: list[dict], t: float) -> dict:
    """Estado da apuração no instante t (0 = início, 1 = fim) no formato do agora.json."""
    estado = {"br": None, "ufs": {}, "municipios": {}}
    por_uf: dict[str, list] = {}
    for m in municipios:
        fracao = min(1.0, max(0.0, (t - m["inicio"]) / m["duracao"]))
        if fracao == 0:
            parcial = {"13": 0, "22": 0, "outros": 0, "validos": 0, "eleitores": m["eleitores"], "apurados": 0, "comparecimento": 0, "secoes": 0.0}
        else:
            lula, flavio = round(m["final"]["13"] * fracao), round(m["final"]["22"] * fracao)
            parcial = {
                "13": lula, "22": flavio, "outros": 0, "validos": lula + flavio,
                "eleitores": m["eleitores"], "apurados": round(m["eleitores"] * fracao),
                "comparecimento": round(m["comparecimento"] * fracao),
                "secoes": round(100 * fracao, 2),
            }
            estado["municipios"][m["chave"]] = {"uf": m["uf"], "nome": m["nome"], **parcial}
        por_uf.setdefault(m["uf"], []).append(parcial)
    estado["ufs"] = {uf: somar(partes) for uf, partes in por_uf.items()}
    estado["br"] = somar([p for partes in por_uf.values() for p in partes])
    return estado


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--passos", type=int, default=90)
    p.add_argument("--intervalo", type=float, default=2, help="segundos reais entre passos")
    p.add_argument("--semente", type=int, default=2026)
    p.add_argument("--ate", type=float, default=1.0, help="para nessa fração da noite (0 a 1), ex.: 0.4")
    p.add_argument("--limpar", action="store_true", help="apaga os arquivos simulados e sai")
    args = p.parse_args()

    if PASTA_2T.exists():
        shutil.rmtree(PASTA_2T)
    if args.limpar:
        print("Simulação apagada; o site volta a mostrar o 1º turno.")
        return

    municipios = preparar(random.Random(args.semente))
    total_secoes = round(sum(m["eleitores"] for m in municipios) * SECOES_POR_ELEITOR)
    saida = Saida(PASTA_2T)
    print(f"Simulando {len(municipios)} municípios em {args.passos} passos. Abra o site e acompanhe.")

    for i in range(round(args.passos * args.ate) + 1):
        t = i / args.passos
        estado = momento(municipios, t * 1.05)  # 5% de folga para todos chegarem a 100%
        relogio = INICIO + DURACAO * t
        estado["gerado"] = relogio.strftime("%d/%m/%Y %H:%M:%S")
        apuradas = round(total_secoes * estado["br"]["secoes"] / 100)
        saida.publicar(estado, apuradas)
        br = estado["br"]
        print(f"  {relogio:%H:%M}  {br['secoes']:6.2f}%  Lula {100 * br['13'] / max(br['validos'], 1):5.2f}%  Flávio {100 * br['22'] / max(br['validos'], 1):5.2f}%")
        if args.intervalo:
            time.sleep(args.intervalo)

    print("Fim da simulação. Para voltar ao 1º turno: simular.py --limpar")


if __name__ == "__main__":
    main()

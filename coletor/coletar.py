"""Coletor ao vivo da apuração (presidente).

A cada ciclo:
  1. lê o acompanhamento de cada UF (-ab), que diz quantas seções cada município já totalizou;
  2. baixa o resultado (-u) do Brasil, das UFs e só dos municípios que mudaram;
  3. guarda os arquivos JWS originais (assinados pelo TSE) em dados/brutos/<turno>/<hora>/;
  4. escreve o estado atual e a curva da apuração para o site.

Uso:
  coletor\\.venv\\Scripts\\python.exe coletor\\coletar.py              # 2º turno, até a apuração terminar
  coletor\\.venv\\Scripts\\python.exe coletor\\coletar.py --turno 1t --uma-vez --saida dados/teste
"""

import argparse
import asyncio
from datetime import datetime
from pathlib import Path

import tse
from publicar import Publicador
from saida import Saida

RAIZ = Path(__file__).resolve().parent.parent


def agora() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


class Coletor:
    def __init__(self, turno: str, saida: Path, brutos: Path):
        self.ele = tse.ELEICOES[turno]
        self.saida = Saida(saida)
        self.brutos = brutos
        self.municipios: dict[str, dict] = {}  # código TSE -> {uf, ibge, nome}
        self.versao: dict[str, tuple] = {}     # código TSE -> (hora totalização, seções) já baixada
        self.estado = {"br": None, "ufs": {}, "municipios": {}}

    def arquivar(self, pasta: Path, url: str, texto: str) -> None:
        pasta.mkdir(parents=True, exist_ok=True)
        (pasta / url.rsplit("/", 1)[1]).write_text(texto, encoding="utf-8")

    async def carregar_municipios(self, cliente: tse.ClienteTSE) -> None:
        _, config = await cliente.baixar(tse.url_municipios(self.ele))
        for abr in config["abr"]:
            for mu in abr["mu"]:
                self.municipios[mu["cd"]] = {"uf": abr["cd"], "ibge": mu.get("cdi") or "", "nome": mu["nm"]}
        print(f"[{agora()}] {len(self.municipios)} municípios carregados")

    async def ciclo(self, cliente: tse.ClienteTSE) -> bool:
        """Faz uma rodada de coleta. Devolve True quando a apuração do Brasil terminou."""
        pasta = self.brutos / datetime.now().strftime("%Y%m%d-%H%M%S")
        ufs = tse.UFS + [tse.EXTERIOR]

        # 1. Acompanhamento: quais municípios têm seções novas
        acomp = await asyncio.gather(*(cliente.baixar(tse.url_acompanhamento(self.ele, uf)) for uf in ufs))
        mudaram = []
        for uf, r in zip(ufs, acomp):
            if not r:
                continue
            for item in r[1].get("abr", []):
                cd = item["cdabr"]
                versao = (item.get("dt"), item.get("ht"), item.get("s", {}).get("st"))
                if cd in self.municipios and int(item.get("s", {}).get("st") or 0) > 0 and self.versao.get(cd) != versao:
                    mudaram.append((cd, versao))

        # 2. Resultados: Brasil, UFs e municípios que mudaram
        br, *res_ufs = await asyncio.gather(
            cliente.baixar(tse.url_resultado(self.ele)),
            *(cliente.baixar(tse.url_resultado(self.ele, uf)) for uf in ufs),
        )
        res_mun = await asyncio.gather(
            *(cliente.baixar(tse.url_resultado(self.ele, self.municipios[cd]["uf"], cd)) for cd, _ in mudaram)
        )

        # 3. Arquivo bruto (só o que veio nesta rodada)
        if br:
            self.arquivar(pasta, tse.url_resultado(self.ele), br[0])
            self.estado["br"] = tse.enxuto(tse.resumir(br[1]))
        for uf, r in zip(ufs, res_ufs):
            if r:
                self.arquivar(pasta, tse.url_resultado(self.ele, uf), r[0])
                self.estado["ufs"][uf] = tse.enxuto(tse.resumir(r[1]))
        atualizados = 0
        for (cd, versao), r in zip(mudaram, res_mun):
            if not r:
                continue
            atualizados += 1
            m = self.municipios[cd]
            self.arquivar(pasta, tse.url_resultado(self.ele, m["uf"], cd), r[0])
            chave = m["ibge"] or f"zz{cd}"
            self.estado["municipios"][chave] = {"uf": m["uf"], "nome": m["nome"], **tse.enxuto(tse.resumir(r[1]))}
            self.versao[cd] = versao

        if not br:
            print(f"[{agora()}] sem resultado do Brasil nesta rodada")
            return False

        # 4. Saída para o site
        br_enx = self.estado["br"]
        resumo_br = tse.resumir(br[1])
        self.estado["gerado"] = resumo_br["gerado"]
        self.saida.publicar(self.estado, resumo_br["secoes"]["apuradas"])

        print(
            f"[{agora()}] {br_enx['secoes']:.2f}% das seções · Lula {br_enx['13']:,} · Flávio {br_enx['22']:,}"
            f" · {atualizados} municípios atualizados".replace(",", ".")
        )
        return br_enx["secoes"] >= 100


async def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--turno", choices=tse.ELEICOES, default="2t")
    p.add_argument("--intervalo", type=int, default=30, help="segundos entre rodadas")
    p.add_argument("--uma-vez", action="store_true", help="faz uma rodada e para")
    p.add_argument("--saida", type=Path, help="pasta dos JSON do site (padrão: site/public/dados/<turno>)")
    p.add_argument("--publicar", action="store_true", help="publica o site no Vercel enquanto coleta")
    p.add_argument("--publicar-a-cada", type=int, default=300, help="segundos entre publicações (padrão: 300)")
    args = p.parse_args()
    publicador = Publicador(args.publicar_a_cada) if args.publicar else None

    saida = args.saida or RAIZ / "site" / "public" / "dados" / args.turno
    brutos = RAIZ / "dados" / "brutos" / args.turno
    coletor = Coletor(args.turno, saida, brutos)

    async with tse.ClienteTSE(simultaneas=8) as cliente:
        await coletor.carregar_municipios(cliente)
        while True:
            inicio = asyncio.get_running_loop().time()
            try:
                terminou = await coletor.ciclo(cliente)
            except Exception as erro:  # rede instável não pode derrubar a noite inteira
                print(f"[{agora()}] erro na rodada: {erro!r}; tentando de novo")
                terminou = False
            # Só publica depois que a apuração começou (antes disso o site já mostra a contagem regressiva)
            if publicador and coletor.estado["br"] and coletor.estado["br"]["validos"] > 0:
                if terminou:
                    # Garante que o resultado final vá ao ar, mesmo fora do intervalo
                    await publicador.esperar()
                    publicador.talvez_publicar(forcar=True)
                    await publicador.esperar()
                else:
                    publicador.talvez_publicar()
            if args.uma_vez or terminou:
                break
            espera = args.intervalo - (asyncio.get_running_loop().time() - inicio)
            await asyncio.sleep(max(5, espera))
    if publicador:
        await publicador.esperar()
    print(f"[{agora()}] coleta encerrada")


if __name__ == "__main__":
    asyncio.run(main())

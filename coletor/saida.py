"""Arquivos que o site lê, escritos pelo coletor real e pelo simulador.

  versao.json     só a hora da última atualização: o site checa este e baixa o resto quando muda
  agora.json      estado atual: Brasil e UFs completos; municípios compactos (ver compactar)
  historico.json  um ponto do Brasil por atualização (curva e linha do tempo)
  eventos.json    "Últimas atualizações": parciais, viradas e estados concluídos
"""

import json
import os
from pathlib import Path

MAX_EVENTOS = 300


def gravar_json(caminho: Path, dados) -> None:
    """Escreve num temporário e troca, para o site nunca ler um arquivo pela metade."""
    caminho.parent.mkdir(parents=True, exist_ok=True)
    temp = caminho.with_suffix(".tmp")
    temp.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temp, caminho)


def _ler(caminho: Path, padrao):
    return json.loads(caminho.read_text(encoding="utf-8")) if caminho.exists() else padrao


# Ordem dos campos de cada município em agora.json; nome, UF e eleitores o site tira do 1º turno
CAMPOS_MUNICIPIO = ["13", "22", "comparecimento", "apurados", "secoes"]


def compactar(estado: dict) -> dict:
    """Municípios viram listas curtas; no 2º turno os válidos são só 13 + 22, então nem vão no arquivo."""
    municipios = {
        codigo: [m.get(campo, 0) for campo in CAMPOS_MUNICIPIO]
        for codigo, m in estado["municipios"].items()
    }
    return {**estado, "campos": CAMPOS_MUNICIPIO, "municipios": municipios}


def _lider(v: dict) -> str | None:
    if v["13"] == v["22"]:
        return None
    return "13" if v["13"] > v["22"] else "22"


def _pct(v: dict, n: str) -> float:
    return round(100 * v[n] / v["validos"], 2) if v["validos"] else 0.0


class Saida:
    def __init__(self, pasta: Path):
        self.pasta = pasta
        self.historico: list[dict] = _ler(pasta / "historico.json", [])
        self.eventos: list[dict] = _ler(pasta / "eventos.json", [])
        # Estados já anunciados como concluídos (para não repetir depois de reiniciar)
        self.concluidas = {e["uf"] for e in self.eventos if e["tipo"] == "uf"}

    def publicar(self, estado: dict, secoes_apuradas: int) -> None:
        gravar_json(self.pasta / "agora.json", compactar(estado))
        self._registrar(estado, secoes_apuradas)
        # Por último: quando o site vê a hora nova, os outros arquivos já estão prontos
        gravar_json(self.pasta / "versao.json", {"gerado": estado["gerado"]})

    def _registrar(self, estado: dict, secoes_apuradas: int) -> None:
        """Acrescenta o ponto da curva e os eventos, se houve seções novas."""
        br = estado["br"]
        hora = estado["gerado"]
        anterior = self.historico[-1] if self.historico else None
        if anterior and anterior.get("st") == secoes_apuradas:
            return

        ponto = {"hora": hora, "secoes": br["secoes"], "st": secoes_apuradas, "13": br["13"], "22": br["22"], "validos": br["validos"]}
        self.historico.append(ponto)
        novos = []

        if secoes_apuradas > 0:
            if not anterior or not anterior.get("st"):
                novos.append({"hora": hora, "tipo": "inicio", "13": _pct(br, "13"), "22": _pct(br, "22")})
            else:
                novos.append({"hora": hora, "tipo": "parcial", "novas": secoes_apuradas - anterior["st"], "13": _pct(br, "13"), "22": _pct(br, "22")})
                lider_antes, lider_agora = _lider(anterior), _lider(br)
                if lider_antes and lider_agora and lider_antes != lider_agora:
                    novos.append({"hora": hora, "tipo": "virada", "lider": lider_agora, "secoes": br["secoes"]})

        for uf, v in sorted(estado["ufs"].items()):
            if v["secoes"] >= 100 and uf not in self.concluidas:
                self.concluidas.add(uf)
                lider = _lider(v)
                novos.append({"hora": hora, "tipo": "uf", "uf": uf, "lider": lider, "pct": _pct(v, lider) if lider else 50.0})

        if br["secoes"] >= 100:
            lider = _lider(br)
            novos.append({"hora": hora, "tipo": "fim", "lider": lider, "pct": _pct(br, lider) if lider else 50.0})

        # Mais recentes primeiro
        self.eventos = (list(reversed(novos)) + self.eventos)[:MAX_EVENTOS]
        gravar_json(self.pasta / "historico.json", self.historico)
        gravar_json(self.pasta / "eventos.json", self.eventos)

"""Arquivos que o site lê, escritos pelo coletor real e pelo simulador.

  agora.json      estado atual: Brasil, UFs e municípios (formato enxuto)
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
        br = estado["br"]
        hora = estado["gerado"]
        gravar_json(self.pasta / "agora.json", estado)

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

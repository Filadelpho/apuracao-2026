"""Publica o site no Vercel a partir deste computador (vercel build + vercel deploy --prebuilt).

O plano gratuito do Vercel permite 100 publicações por dia, contando os envios ao GitHub.
Por isso o coletor publica no máximo a cada `intervalo` segundos (padrão: 5 minutos) e
para de publicar ao chegar em `limite` publicações nesta execução.

Requer `vercel login` e `vercel link` feitos uma vez na raiz do repositório.
"""

import asyncio
import os
import time
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
VERCEL = RAIZ / "site" / "node_modules" / ".bin" / ("vercel.cmd" if os.name == "nt" else "vercel")


def _agora() -> str:
    return datetime.now().strftime("%H:%M:%S")


class Publicador:
    def __init__(self, intervalo: int = 300, limite: int = 80):
        self.intervalo = intervalo
        self.limite = limite
        self.feitas = 0
        self._ultima = 0.0
        self._tarefa: asyncio.Task | None = None

    def talvez_publicar(self, forcar: bool = False) -> None:
        """Dispara uma publicação em segundo plano, se já passou o intervalo e nenhuma está em andamento."""
        if self._tarefa and not self._tarefa.done():
            return
        if self.feitas >= self.limite:
            return
        if not forcar and time.monotonic() - self._ultima < self.intervalo:
            return
        self._ultima = time.monotonic()
        self.feitas += 1
        self._tarefa = asyncio.create_task(self._publicar(self.feitas))

    async def esperar(self) -> None:
        """Espera a publicação em andamento terminar (usado no fim da apuração)."""
        if self._tarefa:
            await self._tarefa

    async def _rodar(self, *args: str) -> tuple[int, str]:
        processo = await asyncio.create_subprocess_exec(
            str(VERCEL), *args, cwd=RAIZ, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        saida, _ = await processo.communicate()
        return processo.returncode, saida.decode("utf-8", errors="replace")

    async def _publicar(self, numero: int) -> None:
        inicio = time.monotonic()
        print(f"[{_agora()}] publicando no Vercel ({numero}/{self.limite})...")
        codigo, saida = await self._rodar("build", "--prod")
        if codigo == 0:
            codigo, saida = await self._rodar("deploy", "--prebuilt", "--prod")
        if codigo == 0:
            print(f"[{_agora()}] publicado em {time.monotonic() - inicio:.0f} s")
        else:
            # Falha não derruba a coleta; a próxima rodada tenta de novo
            print(f"[{_agora()}] falha ao publicar (código {codigo}):\n{saida[-1500:]}")

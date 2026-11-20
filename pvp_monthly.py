"""Top PVP mensal: arrecadação do mês, faixas de prêmio, a posição da conta e a tabela paginada.

O jogo responde `pvp.mensal {pagina}` (0 = primeira) com `pvpMensal {mes, arrecadado, vendas, pool, pctBp, faixas, eu, tabela,
anterior, partidasMin, contaDiasMin}`. `eu` é da conta que perguntou; o resto é igual para todos. Por isso o cache é por
conta e página (TTL curto) e há uma consulta por vez para cada uma.
"""
from __future__ import annotations

import asyncio
import time

TTL_S = 60.0
TIMEOUT_S = 8.0
PAGES_MAX = 30          # o jogo mostra até 25 páginas de 100 linhas (o Top 2.000 premiado e quem ficou de fora)


class MonthlyCache:
    def __init__(self) -> None:
        self._data: dict[tuple[int, int], dict] = {}
        self._waiters: dict[tuple[int, int], list[asyncio.Future]] = {}

    def handle_frame(self, conn, msg: dict) -> None:
        acc = int(getattr(getattr(conn, "acc", None), "index", 0) or 0)
        tabela = msg.get("tabela") if isinstance(msg.get("tabela"), dict) else {}
        try:
            page = max(0, int(tabela.get("pagina") or 0))
        except (TypeError, ValueError):
            page = 0
        if msg.get("erro"):
            # sem página no erro: libera quem espera por esta conta
            for key in [k for k in self._waiters if k[0] == acc]:
                self._resolve(key, None)
            return
        data = {k: v for k, v in msg.items() if k != "t"}
        data["at"] = int(time.time() * 1000)
        self._data[(acc, page)] = {**data, "_t": time.monotonic()}
        self._resolve((acc, page), data)

    def _resolve(self, key: tuple[int, int], data: dict | None) -> None:
        for fut in self._waiters.pop(key, []):
            if not fut.done():
                fut.set_result(data)

    def cached(self, acc: int, page: int) -> dict | None:
        c = self._data.get((acc, page))
        if c and time.monotonic() - c["_t"] < TTL_S:
            return {k: v for k, v in c.items() if k != "_t"}
        return None

    async def get(self, conn, page: int) -> dict | None:
        """Devolve a página (do cache ou pedindo ao jogo por `conn`); None se o jogo não respondeu."""
        acc = int(conn.acc.index)
        page = max(0, min(PAGES_MAX, page))
        hit = self.cached(acc, page)
        if hit:
            return hit
        key = (acc, page)
        fut = asyncio.get_running_loop().create_future()
        first = key not in self._waiters
        self._waiters.setdefault(key, []).append(fut)
        if first:
            try:
                await conn.send_frame({"t": "pvp.mensal", "pagina": page})
            except Exception:
                self._resolve(key, None)
        try:
            return await asyncio.wait_for(fut, TIMEOUT_S)
        except asyncio.TimeoutError:
            self._waiters.pop(key, None)
            return None

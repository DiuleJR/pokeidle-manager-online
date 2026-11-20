"""Tabela do PVP (Top 1.000, 100 por página), compartilhada entre as contas.

O jogo responde `pvp.tabela {pagina}` com `pvpTabela {pagina, paginas, semana, em, antes, linhas, erro}`;
cada linha é `[posição, nick, tier, divisão, pontos, vitórias, derrotas]`. A tabela é igual para todo mundo,
então uma página pedida por uma conta serve às demais: cache de TTL curto e uma consulta por vez por página.
"""
from __future__ import annotations

import asyncio
import time

TTL_S = 60.0
TIMEOUT_S = 8.0
PAGES_MAX = 10


class LadderCache:
    def __init__(self) -> None:
        self._pages: dict[int, dict] = {}
        self._waiters: dict[int, list[asyncio.Future]] = {}
        self.week = ""

    def handle_frame(self, conn, msg: dict) -> None:
        try:
            page = max(1, min(PAGES_MAX, int(msg.get("pagina") or 1)))
        except (TypeError, ValueError):
            page = 1
        if msg.get("erro"):
            self._resolve(page, None)
            return
        week = str(msg.get("semana") or "")
        if week and week != self.week:
            self._pages.clear()
            self.week = week
        try:
            pages = max(1, min(PAGES_MAX, int(msg.get("paginas") or 1)))
        except (TypeError, ValueError):
            pages = 1
        rows = [r for r in (msg.get("linhas") or []) if isinstance(r, (list, tuple)) and len(r) >= 7]
        data = {"page": page, "pages": pages, "week": week, "rows": [
            {"pos": r[0], "nick": r[1], "tier": r[2], "division": r[3], "points": r[4], "wins": r[5], "losses": r[6]}
            for r in rows], "at": int(time.time() * 1000)}
        self._pages[page] = {**data, "_t": time.monotonic()}
        self._resolve(page, data)

    def _resolve(self, page: int, data: dict | None) -> None:
        for fut in self._waiters.pop(page, []):
            if not fut.done():
                fut.set_result(data)

    def cached(self, page: int) -> dict | None:
        c = self._pages.get(page)
        if c and time.monotonic() - c["_t"] < TTL_S:
            return {k: v for k, v in c.items() if k != "_t"}
        return None

    async def get(self, page: int, conn) -> dict | None:
        """Devolve a página (do cache ou pedindo ao jogo por `conn`); None se o jogo não respondeu."""
        page = max(1, min(PAGES_MAX, page))
        hit = self.cached(page)
        if hit:
            return hit
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        first = page not in self._waiters
        self._waiters.setdefault(page, []).append(fut)
        if first:
            try:
                await conn.send_frame({"t": "pvp.tabela", "pagina": page})
            except Exception:
                self._resolve(page, None)
        try:
            return await asyncio.wait_for(fut, TIMEOUT_S)
        except asyncio.TimeoutError:
            self._waiters.pop(page, None)
            return None

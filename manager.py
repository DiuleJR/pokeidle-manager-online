"""Gerenciador de contas em tempo de execução.

Mantém uma AccountConnection por conta ativa do banco e permite adicionar, editar,
ligar/desligar, reiniciar e remover contas sem reiniciar o processo.
"""
from __future__ import annotations

import asyncio
import logging

import config
from config import Settings, build_account_config
from connection import AccountConnection
from market_service import MarketService
from notify import DailyStats, Notifier
from session_stats import SessionStore
from store import Store

log = logging.getLogger("manager")


class LimitReached(Exception):
    """Já existem MAX_ACCOUNTS contas."""


class AccountManager:
    def __init__(self, store: Store, notifier: Notifier, daily: DailyStats) -> None:
        self.store = store
        self.notifier = notifier
        self.daily = daily
        self._conns: dict[int, AccountConnection] = {}
        self._tasks: dict[int, asyncio.Task] = {}
        self._codes = config.parse_close_codes()
        self.market = MarketService(self, store, notifier)

    # ------------------------------------------------------------ estado
    def settings(self) -> Settings:
        """Configuração global atual (WS_URL vem do banco, alterável no painel)."""
        return Settings(self.store.get_setting("ws_url") or config.DEFAULT_WS_URL, self._codes, [])

    def connections(self) -> list[AccountConnection]:
        return [self._conns[i] for i in sorted(self._conns)]

    def get(self, acc_id: int) -> AccountConnection | None:
        return self._conns.get(acc_id)

    # ------------------------------------------------------------ ciclo de vida
    def _on_auth_status(self, acc_id: int, status: str, detail: str) -> None:
        self.store.set_token_status(acc_id, status, detail)

    def _on_token_renewed(self, acc_id: int, token: str) -> None:
        self.store.set_token(acc_id, token)
        log.info("[acc%d] token renovado pelo servidor e salvo", acc_id)

    def _spawn(self, row: dict) -> None:
        acc = build_account_config(row)
        conn = AccountConnection(acc, self.settings(), self.notifier, self.daily)
        conn.on_auth_status = self._on_auth_status
        conn.on_token_renewed = self._on_token_renewed
        self._conns[acc.index] = conn
        self._tasks[acc.index] = asyncio.create_task(conn.run_forever(), name=f"acc{acc.index}")

    async def _stop(self, acc_id: int) -> None:
        task = self._tasks.pop(acc_id, None)
        self._conns.pop(acc_id, None)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def start_all(self) -> None:
        config.set_external_login_wait_min(self.store.get_setting("external_login_wait_min"))
        for row in self.store.list_accounts():
            if row["enabled"]:
                self._spawn(row)
        log.info("%d conta(s) ativa(s)", len(self._conns))

    async def run(self) -> None:
        """Mantém o gerenciador vivo; ao cancelar, derruba as conexões."""
        await self.start_all()
        market_task = asyncio.create_task(self.market.run(), name="market")
        try:
            while True:
                await asyncio.sleep(3600)
        finally:
            market_task.cancel()
            await asyncio.gather(market_task, return_exceptions=True)
            for acc_id in list(self._tasks):
                await self._stop(acc_id)

    # ------------------------------------------------------------ operações do painel
    def add(self, data: dict) -> int:
        if self.store.count_accounts() >= config.MAX_ACCOUNTS:
            raise LimitReached(f"limite de {config.MAX_ACCOUNTS} contas")
        acc_id = self.store.add_account(data)
        row = self.store.get_account(acc_id)
        if row and row["enabled"]:
            self._spawn(row)
        return acc_id

    async def update(self, acc_id: int, changes: dict) -> bool:
        if self.store.get_account(acc_id) is None:
            return False
        self.store.update_account(acc_id, changes)
        await self.restart(acc_id)
        return True

    async def restart(self, acc_id: int) -> bool:
        await self._stop(acc_id)
        row = self.store.get_account(acc_id)
        if row is None:
            return False
        if row["enabled"]:
            self._spawn(row)
        return True

    async def remove(self, acc_id: int) -> bool:
        if self.store.get_account(acc_id) is None:
            return False
        await self._stop(acc_id)
        self.store.delete_account(acc_id)
        SessionStore.shared().delete(f"acc{acc_id}")
        return True

    async def apply_global_settings(self) -> None:
        """Reaplica webhook/fuso/hora do relatório e reinicia as contas se o WS_URL mudou."""
        import notify
        self.notifier.url = self.store.get_setting("discord_webhook").strip()
        self.daily.set_schedule(int(self.store.get_setting("report_hour") or 0),
                                self.store.get_setting("report_tz"))
        notify.set_public_url(self.store.get_setting("public_url"))
        config.set_external_login_wait_min(self.store.get_setting("external_login_wait_min"))
        new_ws = self.settings().ws_url
        if any(c.settings.ws_url != new_ws for c in self._conns.values()):
            for acc_id in list(self._conns):
                await self.restart(acc_id)

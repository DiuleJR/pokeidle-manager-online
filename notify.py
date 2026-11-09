"""Notificações para um webhook do Discord + estatísticas diárias.

Webhook, hora da virada do dia e fuso são configurados no painel (aba Configurações).
As variáveis DISCORD_WEBHOOK_URL, DAILY_REPORT_HOUR e REPORT_TZ do .env só são lidas
como padrão inicial (e importadas para o banco na 1ª execução).

O envio é assíncrono por uma fila: nunca bloqueia o bot e respeita o rate limit (429).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
import time
from datetime import datetime, timedelta, timezone, tzinfo

import aiohttp

from session_stats import ITEM_LABELS

log = logging.getLogger("notify")

RED, GREEN, GOLD, BLUE = 0xE74C3C, 0x2ECC71, 0xF1C40F, 0x3498DB
BOT_NAME = "Link Kun"

# Base pública do dashboard (ex.: https://seu-dominio.exemplo), usada para
# montar a URL do ícone (thumbnail) nos embeds — ex.: item raro obtido. Sem ela,
# os embeds saem sem thumbnail (nada quebra, só fica sem o ícone).
PUBLIC_URL = os.getenv("PUBLIC_URL", "").strip().rstrip("/")


def set_public_url(url: str) -> None:
    """Define a URL pública do dashboard (configurável no painel)."""
    global PUBLIC_URL
    PUBLIC_URL = (url or "").strip().rstrip("/")


def rare_icon_url(key: str) -> str | None:
    """URL do ícone padronizado (scripts/gen_rare_icons.py) de um item raro
    da sessão (chaves de session_stats.TRACKED), ou None sem PUBLIC_URL."""
    return f"{PUBLIC_URL}/rare-icons/{key}.png" if PUBLIC_URL else None


def fmt_duration(seconds: float) -> str:
    s = int(max(seconds, 0))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}h{m:02d}min"
    if m:
        return f"{m}min{sec:02d}s"
    return f"{sec}s"


class Notifier:
    def __init__(self, url: str | None = None) -> None:
        self.url = (url if url is not None else os.getenv("DISCORD_WEBHOOK_URL", "")).strip()
        self._queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=200)

    @property
    def enabled(self) -> bool:
        return bool(self.url)

    def send(self, title: str, description: str = "", color: int = BLUE,
             fields: list[tuple[str, str, bool]] | None = None,
             thumbnail: str | None = None) -> None:
        """Enfileira um embed (sem await). Descarta se desligado ou fila cheia.
        `thumbnail` (se dado) vira a imagem no canto superior direito do embed."""
        if not self.enabled:
            return
        embed = {
            "title": title,
            "description": description,
            "color": color,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if fields:
            embed["fields"] = [{"name": n, "value": v, "inline": i} for n, v, i in fields]
        if thumbnail:
            embed["thumbnail"] = {"url": thumbnail}
        try:
            self._queue.put_nowait({"username": BOT_NAME, "embeds": [embed]})
        except asyncio.QueueFull:
            log.warning("fila de notificações cheia; mensagem descartada")

    async def run(self) -> None:
        """Worker: esvazia a fila para sempre (rodar em paralelo com o bot).
        Fica de pé mesmo com o webhook vazio: ele pode ser definido depois, pelo painel."""
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            while True:
                payload = await self._queue.get()
                if not self.enabled:
                    continue
                for attempt in range(4):
                    try:
                        async with session.post(self.url, json=payload) as r:
                            if r.status == 429:
                                retry = 1.0
                                try:
                                    retry = float((await r.json()).get("retry_after", 1))
                                except Exception:  # noqa: BLE001
                                    pass
                                await asyncio.sleep(retry + 0.2)
                                continue
                            if r.status >= 400:
                                log.warning("webhook respondeu HTTP %s", r.status)
                            break
                    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                        log.warning("falha ao enviar webhook (%s), tentativa %d", type(e).__name__, attempt + 1)
                        await asyncio.sleep(2 * (attempt + 1))
                await asyncio.sleep(0.5)  # espaçamento entre mensagens


class DailyStats:
    """XP, ouro, kills e itens raros por conta no período corrente (persistido em JSON)."""

    def __init__(self, path: str | None = None, report_hour: int | None = None,
                 tz_name: str | None = None) -> None:
        self.path = path or os.getenv("DAILY_FILE") or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "daily_state.json")
        self.report_hour = (report_hour if report_hour is not None
                            else int(os.getenv("DAILY_REPORT_HOUR", "0") or 0)) % 24
        self.tz = _load_tz(tz_name or os.getenv("REPORT_TZ", "America/Sao_Paulo"))
        self._dirty = False
        self.period: str = self.current_period()
        self.accounts: dict[str, dict] = {}
        try:
            with open(self.path, encoding="utf8") as fh:
                d = json.load(fh)
            if isinstance(d, dict) and isinstance(d.get("accounts"), dict):
                self.period = str(d.get("period") or self.period)
                self.accounts = _migrate_account_keys(d["accounts"])
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as e:
            log.warning("daily_state ilegível (%s); começando do zero", e)

    def set_schedule(self, report_hour: int, tz_name: str) -> None:
        """Muda hora de virada do dia e fuso (painel). O período corrente é recalculado no próximo ciclo."""
        self.report_hour = int(report_hour) % 24
        self.tz = _load_tz(tz_name or "America/Sao_Paulo")

    # --- período
    def current_period(self) -> str:
        return (datetime.now(self.tz) - timedelta(hours=self.report_hour)).date().isoformat()

    # --- contadores
    def _acc(self, name: str) -> dict:
        return self.accounts.setdefault(name, {"xp": 0, "gold": 0, "kills": 0,
                                                "items": {k: 0 for k in ITEM_LABELS}})

    def add_kill(self, name: str, xp: int, gold: int) -> None:
        a = self._acc(name)
        a["xp"] += int(xp or 0)
        a["gold"] += int(gold or 0)
        a["kills"] += 1
        self._dirty = True

    def add_item(self, name: str, key: str, n: int) -> int:
        """Soma n itens raros e devolve o total do período para aquele item."""
        items = self._acc(name)["items"]
        items[key] = items.get(key, 0) + n
        self._dirty = True
        self.save()
        return items[key]

    # --- persistência
    def save(self) -> None:
        self._dirty = False
        try:
            fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path), suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf8") as fh:
                json.dump({"period": self.period, "accounts": self.accounts}, fh)
            os.replace(tmp, self.path)
        except OSError as e:
            log.warning("não consegui gravar %s: %s", self.path, e)

    # --- relatório
    def has_data(self) -> bool:
        return any(a["kills"] or any(a["items"].values()) for a in self.accounts.values())

    def send_report(self, notifier: Notifier) -> None:
        fields: list[tuple[str, str, bool]] = []
        tot_xp = tot_gold = tot_kills = 0
        tot_items = {k: 0 for k in ITEM_LABELS}
        for name, a in sorted(self.accounts.items()):
            tot_xp += a["xp"]; tot_gold += a["gold"]; tot_kills += a["kills"]
            for k, v in a["items"].items():
                tot_items[k] = tot_items.get(k, 0) + v
            fields.append((name, f"⭐ XP: **{a['xp']:,}**\n💰 Ouro: **{a['gold']:,}**\n"
                                 f"⚔️ Kills: {a['kills']:,}\n💎 Raros: {_items_text(a['items'])}", True))
        if len(self.accounts) > 1:
            fields.append(("Total", f"⭐ XP: **{tot_xp:,}**\n💰 Ouro: **{tot_gold:,}**\n"
                                    f"⚔️ Kills: {tot_kills:,}\n💎 Raros: {_items_text(tot_items)}", False))
        notifier.send(f"📊 Relatório diário — {_br_date(self.period)}",
                      "Resumo do dia por conta." if fields else "Sem atividade no período.",
                      BLUE, fields)

    def roll_over(self, notifier: Notifier) -> None:
        """Se o período mudou: envia o relatório do anterior e zera."""
        now_period = self.current_period()
        if now_period == self.period:
            return
        if self.has_data():
            self.send_report(notifier)
        self.period = now_period
        self.accounts = {}
        self.save()

    async def run(self, notifier: Notifier) -> None:
        while True:
            self.roll_over(notifier)
            if self._dirty:
                self.save()
            await asyncio.sleep(30)


_ACC_PREFIX = re.compile(r"^ACC\d+:(.+)$")


def _migrate_account_keys(accounts: dict) -> dict:
    """Normaliza chaves antigas "ACCn:nick" (de antes da correção do webhook)
    para o nick puro, mesclando com uma entrada "nick" já existente no mesmo
    período, se houver."""
    out: dict = {}
    for name, a in accounts.items():
        m = _ACC_PREFIX.match(name)
        key = m.group(1) if m else name
        if key not in out:
            out[key] = a
            continue
        prev = out[key]
        prev["xp"] += a.get("xp", 0)
        prev["gold"] += a.get("gold", 0)
        prev["kills"] += a.get("kills", 0)
        for k, v in (a.get("items") or {}).items():
            prev.setdefault("items", {})[k] = prev.get("items", {}).get(k, 0) + v
    return out


def _items_text(items: dict) -> str:
    parts = [f"{ITEM_LABELS.get(k, k)} ×{v}" for k, v in items.items() if v]
    return ", ".join(parts) if parts else "nenhum"


def _br_date(period: str) -> str:
    try:
        y, m, d = period.split("-")
        return f"{d}/{m}/{y}"
    except ValueError:
        return period


def _load_tz(name: str) -> tzinfo:
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception:  # noqa: BLE001 - sem tzdata: usa UTC-3 fixo
        log.warning("fuso %s indisponível; usando UTC-3", name)
        return timezone(timedelta(hours=-3))

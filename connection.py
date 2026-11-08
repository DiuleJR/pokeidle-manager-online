"""Gerenciador de conexão WebSocket por conta, sempre via proxy ISP dedicado.

Estratégia de proxy: `python-socks` (dependência do aiohttp-socks) abre um túnel
TCP (HTTP CONNECT ou SOCKS5, com autenticação) até o host do jogo; o socket já
tunelado é entregue ao `websockets` via `sock=`. Nada sai pelo IP da VPS: se o
túnel falhar, a conta NÃO conecta (sem fallback direto).

Protocolo (spec do protocolo): hello -> welcome (-> amigos, ignorado aqui).
"""
from __future__ import annotations

import asyncio
import enum
import json
import logging
import ssl
import time
from urllib.parse import urlparse

import aiohttp
from aiohttp_socks import ProxyConnector
from python_socks import ProxyError
from python_socks.async_.asyncio import Proxy  # v1: connect() devolve um socket.socket
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

import config
from balls import BallManager
from config import AccountConfig, Settings
from hunt import HuntManager
from inventory import InventoryView
from notify import GOLD, GREEN, RED, DailyStats, Notifier, fmt_duration, rare_icon_url
from session_stats import ITEM_LABELS, SessionItems, SessionStore
from shop import AutoRestock, ShopManager, ball_ids_resolver, potion_ids_resolver

log = logging.getLogger("conn")


class State(enum.Enum):
    DISCONNECTED = "DISCONNECTED"
    CONNECTING = "CONNECTING"
    AUTHENTICATING = "AUTHENTICATING"
    ONLINE = "ONLINE"
    PAUSED_COOLDOWN = "PAUSED_COOLDOWN"


class AuthRejected(Exception):
    """Servidor rejeitou credenciais (401/403) ou sessão tomada por login externo."""


class AccountConnection:
    def __init__(self, account: AccountConfig, settings: Settings,
                 notifier: Notifier | None = None, daily: DailyStats | None = None):
        self.acc = account
        self.settings = settings
        self.notifier = notifier or Notifier("")
        self.daily = daily
        self._was_online = False          # já esteve ONLINE (evita alertar falha de 1ª conexão)
        self._down_since: float | None = None
        self._down_alerted = False
        self.state = State.DISCONNECTED
        self.exit_ip = "?"
        self._no_proxy = account.proxy is None
        self.estado: dict = {}   # snapshot do welcome, mutado pelo HuntManager
        self.hunts: list = []
        self.itens_nossos: dict[int, dict] = {}   # welcome.itensNossos: itens só do servidor (nome/ícone)
        self.session_started: float | None = None  # epoch do 1º ONLINE deste processo
        self.session_items = SessionItems()
        # sessão persistida: sobrevive a reinícios do bot (início + itens coletados)
        self._session_key = f"acc{account.index}"
        self.session_store = SessionStore.shared()
        saved = self.session_store.get(self._session_key)
        if saved:
            if isinstance(saved.get("started_at"), (int, float)):
                self.session_started = float(saved["started_at"])
            for k, v in (saved.get("gained") or {}).items():
                if k in self.session_items.gained and isinstance(v, int):
                    self.session_items.gained[k] = v
        self.hunt = HuntManager(account.name, self.estado, self.hunts)
        if self.daily:
            self.hunt.on_kill = lambda xp, gold: self.daily.add_kill(self.acc.nick, xp, gold)
        self.balls = BallManager(account.name, self.estado, account.ball_priority)
        self.shop = ShopManager(account.name, self.estado)
        self.restockers: list[AutoRestock] = []
        if account.auto_potion:
            self.restockers.append(AutoRestock(
                account.name, self.estado, self.shop, kind="item",
                get_ids=potion_ids_resolver(self.estado, self.hunt.active_pokemon, account.potion_id),
                threshold=account.potion_restock_threshold, qty=account.potion_restock_qty))
        if account.auto_ball_restock:
            self.restockers.append(AutoRestock(
                account.name, self.estado, self.shop, kind="ball",
                get_ids=ball_ids_resolver(self.estado, account.ball_priority, account.ball_id),
                threshold=account.ball_restock_threshold, qty=account.ball_restock_qty))
        self.inventory = InventoryView(self.estado)
        self._log = logging.LoggerAdapter(log, {})

    # ------------------------------------------------------------------ logs
    def _set(self, state: State, msg: str = "", reason: str = "") -> None:
        self.state = state
        # Nunca logar token/credenciais de proxy.
        proxy_label = "DIRETO (sem proxy)" if self._no_proxy else self.acc.proxy.label
        log.info("[%s] %-15s ip=%s proxy=%s %s", self.acc.name, state.value,
                 self.exit_ip, proxy_label, msg)
        self._alert_state(state, reason)

    def _alert_state(self, state: State, reason: str) -> None:
        """Avisa no Discord a queda (1x por queda) e a volta, com o tempo fora.
        Título = nick da conta (sem o prefixo ACCn: usado só nos logs)."""
        if state == State.ONLINE:
            if self._down_alerted and self._down_since is not None:
                self.notifier.send(
                    self.acc.nick, "🟢 Voltou ao ar.", GREEN,
                    [("Tempo fora", fmt_duration(time.time() - self._down_since), True)])
            self._was_online, self._down_since, self._down_alerted = True, None, False
        elif state in (State.DISCONNECTED, State.PAUSED_COOLDOWN) and self._was_online:
            if self._down_since is None:
                self._down_since = time.time()
            if not self._down_alerted:
                self._down_alerted = True
                self.notifier.send(self.acc.nick, "🔴 Caiu.", RED,
                                   [("Motivo", reason or "queda de conexão", False)])

    # ----------------------------------------------------------- proxy utils
    async def _probe_exit_ip(self) -> str:
        """Descobre o IP de saída real (via proxy, ou direto se não configurado)."""
        connector = ProxyConnector.from_url(self.acc.proxy.url) if not self._no_proxy else None
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(connector=connector, timeout=timeout) as s:
            async with s.get("https://api.ipify.org") as r:
                return (await r.text()).strip()

    async def _open_tunnel(self):
        """Abre socket TCP até o servidor do jogo via proxy. Só chamada quando há proxy."""
        u = urlparse(self.settings.ws_url)
        port = u.port or (443 if u.scheme == "wss" else 80)
        proxy = Proxy.from_url(self.acc.proxy.url)
        return await proxy.connect(dest_host=u.hostname, dest_port=port, timeout=20)

    # ----------------------------------------------------------- handshake
    def _hello(self) -> str:
        return json.dumps({
            "t": "hello",
            "nick": self.acc.nick,
            "token": self.acc.token,
            "delta": 1,                    # ❓ função desconhecida; valor observado
            "dispositivo": self.acc.device_id,
        })

    async def _wait_welcome(self, ws) -> dict:
        """Aguarda 'welcome' por até 15s; ignora frames de outro tipo antes dele."""
        async def _loop():
            async for raw in ws:
                msg = _parse(raw)
                if msg.get("t") == "welcome":
                    return msg
        try:
            return await asyncio.wait_for(_loop(), config.WELCOME_TIMEOUT)
        except asyncio.TimeoutError:
            raise ConnectionError(f"welcome não recebido em {config.WELCOME_TIMEOUT}s")

    # ----------------------------------------------------------- sessão
    async def _session(self) -> None:
        self._set(State.CONNECTING, "abrindo túnel" if not self._no_proxy else "conectando direto")
        self.exit_ip = await self._probe_exit_ip()

        u = urlparse(self.settings.ws_url)
        ssl_ctx = ssl.create_default_context() if u.scheme == "wss" else None
        # Sem proxy: deixa o websockets abrir a conexão TCP/TLS ele mesmo.
        # Com proxy: o túnel já chega conectado via Proxy.connect(), então
        # passamos o socket pronto com sock= e pulamos a resolução de host.
        sock = None if self._no_proxy else await self._open_tunnel()
        connect_kwargs = {}
        if sock is not None:
            connect_kwargs["sock"] = sock
            connect_kwargs["server_hostname"] = u.hostname if ssl_ctx else None
        try:
            async with connect(
                self.settings.ws_url,
                ssl=ssl_ctx,
                **connect_kwargs,
                # Heartbeat: ping a cada 30s; sem pong em 90s => ConnectionClosed.
                ping_interval=config.PING_INTERVAL,
                ping_timeout=config.PING_TIMEOUT,
                max_size=None,             # 'welcome' é um snapshot grande
                open_timeout=20,
            ) as ws:
                self._set(State.AUTHENTICATING, "hello enviado")
                await ws.send(self._hello())
                welcome = await self._wait_welcome(ws)
                # in-place: self.estado/self.hunts são os mesmos objetos que o
                # HuntManager já referencia (passados por self.hunt no __init__).
                self.estado.clear()
                self.estado.update(welcome.get("estado", {}))
                self.hunts.clear()
                self.hunts.extend(welcome.get("hunts", []))
                self.itens_nossos = {int(i["id"]): i for i in welcome.get("itensNossos", [])
                                     if isinstance(i, dict) and "id" in i}
                if self.session_started is None:
                    self.session_started = time.time()
                    self.session_store.save(self._session_key, self.session_started, self.session_items.gained)
                self.session_items.reset(self.estado)
                self._set(State.ONLINE, f"welcome ok level={self.estado.get('level')}")

                self.hunt.on_welcome()
                self.hunt.bind(ws)
                self.balls.bind(ws)
                self.shop.bind(ws)
                if self.acc.hunt_slug and self.acc.hunt_slug != self.estado.get("huntSlug"):
                    await self.hunt.select_hunt(self.acc.hunt_slug)

                # Tarefas de background rodam em paralelo só enquanto a conexão
                # viver; quando a sessão acaba (com ou sem erro), são canceladas.
                background = [
                    asyncio.create_task(self._status_logger()),
                    asyncio.create_task(self._inventory_logger()),
                ]
                if self.acc.auto_catch:
                    background.append(asyncio.create_task(self.balls.run_forever()))
                if self.restockers:
                    background.append(asyncio.create_task(self._auto_restock_loop()))

                recv_task = asyncio.create_task(self._recv_loop(ws))
                try:
                    await recv_task
                finally:
                    for t in background:
                        t.cancel()
                    await asyncio.gather(*background, return_exceptions=True)
        except InvalidStatus as e:  # rejeição HTTP no upgrade
            code = e.response.status_code
            if code in (401, 403):
                raise AuthRejected(f"HTTP {code}") from e
            raise

    async def _recv_loop(self, ws) -> None:
        """Loop de leitura. Frames de hunt/combate/estado vão para o HuntManager;
        futuros handlers (inventário, balls, etc.) plugam aqui do mesmo jeito."""
        try:
            async for raw in ws:
                msg = _parse(raw)
                self.hunt.handle_frame(msg)
                self.balls.handle_frame(msg)
                self.shop.handle_frame(msg)
                before = dict(self.session_items.gained)
                self.session_items.update(self.estado)
                if self.session_items.gained != before:
                    self._on_rare_items(before)
                    self.session_store.save(self._session_key, self.session_started, self.session_items.gained)
        except ConnectionClosed as e:
            code = e.rcvd.code if e.rcvd else None
            if code in self.settings.external_login_codes:
                # 4001 confirmado por teste real = login externo; os demais códigos
                # desse conjunto (ex. 4003 "provedor-banido") têm outra causa, não
                # documentada como "login externo" — não generalizar o motivo.
                sufixo = " (login externo)" if code == 4001 else ""
                raise AuthRejected(f"close code {code}{sufixo}") from e
            raise

    def _on_rare_items(self, before: dict[str, int]) -> None:
        """Avisa no Discord cada item raro novo da sessão, exceto o Boss Token
        (o usuário pediu para não ser notificado desse, mas ele continua
        contado no relatório diário normalmente)."""
        for key, now in self.session_items.gained.items():
            n = now - before.get(key, 0)
            if n <= 0:
                continue
            total = self.daily.add_item(self.acc.nick, key, n) if self.daily else n
            if key == "boss":
                continue
            label = ITEM_LABELS.get(key, key)
            self.notifier.send(self.acc.nick, f"💎 pegou **{n}× {label}**", GOLD,
                               [("Total no dia", str(total), True)], thumbnail=rare_icon_url(key))

    async def _status_logger(self) -> None:
        """Loga periodicamente Pokémon ativo, HP, XP/h, Gold/h, progresso da
        hunt e um resumo compacto do inventário (balls/potions/pokémons)."""
        while True:
            await asyncio.sleep(config.STATUS_LOG_INTERVAL)
            log.info("[%s] %s | capturas=%s falhas=%s | %s", self.acc.name,
                     self.hunt.status_line(), self.balls.caught, self.balls.failed,
                     self.inventory.summary_line())

    async def _inventory_logger(self) -> None:
        """Relatório detalhado de inventário (todos os items, pokémons,
        pokédex), num intervalo mais espaçado que o status compacto."""
        while True:
            await asyncio.sleep(config.INVENTORY_LOG_INTERVAL)
            for line in self.inventory.full_report().splitlines():
                log.info("[%s] %s", self.acc.name, line)

    async def _auto_restock_loop(self) -> None:
        """Verifica periodicamente o estoque da Potion e da Ball equipadas e
        repõe via shop.buy (uma compra por vez, aguardando k:"compra")."""
        while True:
            await asyncio.sleep(config.POTION_CHECK_INTERVAL_S)
            for r in self.restockers:
                await r.check_and_restock()

    # ----------------------------------------------------------- supervisor
    async def run_forever(self) -> None:
        """Mantém a conta conectada; aplica cooldown de 5 min em rejeição."""
        while True:
            try:
                await self._session()
                self._set(State.DISCONNECTED, "sessão encerrada", "servidor encerrou a sessão")
            except AuthRejected as e:
                self._set(State.PAUSED_COOLDOWN,
                          f"{e}; aguardando {config.COOLDOWN_SECONDS}s",
                          f"{e}; nova tentativa em {config.COOLDOWN_SECONDS // 60}min")
                await asyncio.sleep(config.COOLDOWN_SECONDS)
                continue
            except asyncio.CancelledError:
                raise
            except (ProxyError, OSError, aiohttp.ClientError) as e:
                self._set(State.DISCONNECTED, f"falha de proxy/rede: {e!r}",
                          f"falha de proxy/rede ({type(e).__name__})")
            except Exception as e:  # noqa: BLE001 - supervisor não pode morrer
                self._set(State.DISCONNECTED, f"erro: {e!r}", f"erro: {type(e).__name__}")
            await asyncio.sleep(config.RECONNECT_DELAY)


def _parse(raw) -> dict:
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}

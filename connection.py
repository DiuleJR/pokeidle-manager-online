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
from dataclasses import replace
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
from market import MarketClient
from notify import GOLD, GREEN, RED, DailyStats, Notifier, fmt_duration, rare_icon_url
from game_data import item_name
from session_stats import ITEM_LABELS, TRACKED, SessionItems, SessionStore
from shop import AutoRestock, ShopManager, ball_ids_resolver, potion_ids_resolver

log = logging.getLogger("conn")


class State(enum.Enum):
    DISCONNECTED = "DISCONNECTED"
    CONNECTING = "CONNECTING"
    AUTHENTICATING = "AUTHENTICATING"
    ONLINE = "ONLINE"
    PAUSED_COOLDOWN = "PAUSED_COOLDOWN"
    BLOCKED = "BLOCKED"   # precisa de ação do usuário (token inválido, ban...): não reconecta sozinho


class AuthRejected(Exception):
    """Servidor rejeitou credenciais (401/403) ou sessão tomada por login externo."""


class AccountBlocked(Exception):
    """O jogo recusou a conta por um motivo que não some sozinho (token inválido, ban...)."""

    def __init__(self, kind: str, detail: str) -> None:
        super().__init__(detail)
        self.kind = kind
        self.detail = detail


class NetworkFull(Exception):
    """Rede/IP no limite de contas online: tentar de novo em instantes."""


# Frames {t:'erro', chave:...} do jogo que significam "esta conta/rede não entra".
# Chaves observadas no cliente web (ALERTAS_DO_SOCKET).
BLOCKING_KEYS: dict[str, tuple[str, str]] = {
    "auth.sessaoInvalida": ("invalid", "Sessão inválida ou expirada: reimporte a conta"),
    "auth.precisaLogin": ("invalid", "Sessão inválida ou expirada: reimporte a conta"),
    "auth.contaBanida": ("banned", "Conta banida pelo jogo"),
    "auth.ipBanido": ("net_banned", "Rede (IP) banida pelo jogo"),
    "auth.provedorBanido": ("net_banned", "Provedor de rede banido pelo jogo"),
    "auth.contaExcluida": ("deleted", "Conta excluída"),
    "login.precisaNick": ("needs_nick", "A conta precisa escolher um nick dentro do jogo"),
}
NETWORK_FULL_KEYS = {"login.limiteOnlineIp", "login.limiteOnlineIpLista"}
NETWORK_FULL_RETRY_S = 30


def build_hello(acc: AccountConfig) -> str:
    return json.dumps({
        "t": "hello",
        "nick": acc.nick,
        "token": acc.token,
        "delta": 1,                    # função desconhecida; valor observado
        "dispositivo": acc.device_id,
    })


async def open_tunnel(acc: AccountConfig, ws_url: str):
    """Abre socket TCP até o servidor do jogo via proxy da conta (só quando há proxy)."""
    u = urlparse(ws_url)
    port = u.port or (443 if u.scheme == "wss" else 80)
    proxy = Proxy.from_url(acc.proxy.url)
    return await proxy.connect(dest_host=u.hostname, dest_port=port, timeout=20)


async def probe_exit_ip(acc_proxy) -> str:
    """IP de saída real (via proxy, ou direto se proxy=None)."""
    connector = ProxyConnector.from_url(acc_proxy.url) if acc_proxy is not None else None
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as s:
        async with s.get("https://api.ipify.org") as r:
            return (await r.text()).strip()


async def probe_account(acc: AccountConfig, ws_url: str, timeout: float = 25.0) -> dict:
    """Testa uma conta: hello -> welcome. Devolve {ok, kind, detail, nick?, level?, hunts?}.

    ATENÇÃO: conecta de verdade com o token. Se o mesmo token estiver aberto em outro
    lugar (navegador, outro bot), o jogo derruba o outro (close 4001)."""
    u = urlparse(ws_url)
    ssl_ctx = ssl.create_default_context() if u.scheme == "wss" else None
    kwargs: dict = {}
    try:
        if acc.proxy is not None:
            sock = await open_tunnel(acc, ws_url)
            kwargs = {"sock": sock, "server_hostname": u.hostname if ssl_ctx else None}
        async with connect(ws_url, ssl=ssl_ctx, max_size=None, open_timeout=20, **kwargs) as ws:
            await ws.send(build_hello(acc))

            async def _wait() -> dict:
                async for raw in ws:
                    msg = _parse(raw)
                    if msg.get("t") == "welcome":
                        est = msg.get("estado") or {}
                        return {"ok": True, "kind": "ok", "detail": "", "nick": est.get("nick"),
                                "level": est.get("level"),
                                "hunts": [h.get("slug") for h in msg.get("hunts", []) if isinstance(h, dict)]}
                    if msg.get("t") == "erro":
                        chave = msg.get("chave") or ""
                        if chave in BLOCKING_KEYS:
                            kind, detail = BLOCKING_KEYS[chave]
                            return {"ok": False, "kind": kind, "detail": detail}
                        if chave in NETWORK_FULL_KEYS:
                            return {"ok": False, "kind": "net_full",
                                    "detail": "Rede no limite de contas online: tente de novo em instantes"}
                return {"ok": False, "kind": "closed", "detail": "O servidor fechou a conexão sem welcome"}

            try:
                return await asyncio.wait_for(_wait(), timeout)
            except asyncio.TimeoutError:
                return {"ok": False, "kind": "timeout", "detail": f"welcome não recebido em {timeout:.0f}s"}
    except ConnectionClosed as e:
        code = e.rcvd.code if e.rcvd else None
        return {"ok": False, "kind": "closed", "detail": f"Conexão fechada (code {code})"}
    except InvalidStatus as e:
        return {"ok": False, "kind": "http", "detail": f"HTTP {e.response.status_code} no upgrade"}
    except (ProxyError, OSError, aiohttp.ClientError) as e:
        return {"ok": False, "kind": "network", "detail": f"Falha de proxy/rede: {type(e).__name__}"}


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
        self.block: dict | None = None    # {kind, detail} quando BLOCKED
        self.last_reason = ""             # último motivo de queda/pausa, para o painel
        self.on_auth_status = None        # callback(acc_id, status, detail): painel/banco
        self.on_token_renewed = None      # callback(acc_id, novo_token)
        self.exit_ip = "?"
        self._no_proxy = account.proxy is None
        self.estado: dict = {}   # snapshot do welcome, mutado pelo HuntManager
        self.hunts: list = []
        self.mercado_cfg: dict = {}               # welcome.mercado (catálogo, preços mínimos...)
        self._rare_last: dict[int, int] | None = None   # baseline dos itens raros do servidor (ids >= 70000)
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
        self.market = MarketClient(account.name, self.estado)
        self.pending_hunt: str | None = None      # hunt pedida no painel, aguardando a trava de combate acabar
        self.restockers: list[AutoRestock] = []
        if account.auto_potion:
            self.restockers.append(AutoRestock(
                account.name, self.estado, self.shop, kind="item",
                get_ids=potion_ids_resolver(self.estado, self.hunt.active_pokemon, lambda: self.acc.potion_id),
                threshold=account.potion_restock_threshold, qty=account.potion_restock_qty))
        if account.auto_ball_restock:
            self.restockers.append(AutoRestock(
                account.name, self.estado, self.shop, kind="ball",
                get_ids=ball_ids_resolver(self.estado, account.ball_priority, lambda: self.acc.ball_id),
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
        elif state in (State.DISCONNECTED, State.PAUSED_COOLDOWN, State.BLOCKED) and self._was_online:
            if self._down_since is None:
                self._down_since = time.time()
            if not self._down_alerted:
                self._down_alerted = True
                self.notifier.send(self.acc.nick, "🔴 Caiu.", RED,
                                   [("Motivo", reason or "queda de conexão", False)])

    # ----------------------------------------------------------- proxy utils
    async def _probe_exit_ip(self) -> str:
        """Descobre o IP de saída real (via proxy, ou direto se não configurado)."""
        return await probe_exit_ip(None if self._no_proxy else self.acc.proxy)

    async def _open_tunnel(self):
        """Abre socket TCP até o servidor do jogo via proxy. Só chamada quando há proxy."""
        return await open_tunnel(self.acc, self.settings.ws_url)

    # ----------------------------------------------------------- handshake
    def _hello(self) -> str:
        return build_hello(self.acc)

    def _check_erro(self, msg: dict) -> None:
        """Transforma frames de recusa do jogo em exceções: o bot para (ou espera) em vez de
        ficar reconectando sem adiantar. Não loga o token."""
        if msg.get("t") != "erro":
            return
        chave = msg.get("chave") or ""
        if chave in BLOCKING_KEYS:
            kind, detail = BLOCKING_KEYS[chave]
            if kind == "banned" and msg.get("motivoBan"):
                detail = f"{detail}: {msg['motivoBan']}"
            raise AccountBlocked(kind, detail)
        if chave in NETWORK_FULL_KEYS:
            raise NetworkFull(chave)

    async def _wait_welcome(self, ws) -> dict:
        """Aguarda 'welcome' por até 15s; ignora frames de outro tipo antes dele."""
        async def _loop():
            async for raw in ws:
                msg = _parse(raw)
                self._check_erro(msg)
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
                m = welcome.get("mercado")  # catálogo da vitrine + limites (preço mínimo, espera de compra)
                self.mercado_cfg = m if isinstance(m, dict) else {}
                if self.session_started is None:
                    self.session_started = time.time()
                    self.session_store.save(self._session_key, self.session_started, self.session_items.gained)
                if isinstance(self.estado.get("servidorAgora"), (int, float)):
                    self.market.clock_offset_ms = int(self.estado["servidorAgora"]) - int(time.time() * 1000)
                self.session_items.reset(self.estado)
                self._rare_last = self._rare_counts()
                self.block = None
                self.last_reason = ""
                self._set(State.ONLINE, f"welcome ok level={self.estado.get('level')}")
                if self.on_auth_status:
                    self.on_auth_status(self.acc.index, "ok", "")

                self.hunt.on_welcome()
                self.hunt.bind(ws)
                self.balls.bind(ws)
                self.shop.bind(ws)
                self.market.bind(ws)
                if self.acc.hunt_slug and self.acc.hunt_slug != self.estado.get("huntSlug"):
                    await self.hunt.select_hunt(self.acc.hunt_slug)

                # Tarefas de background rodam em paralelo só enquanto a conexão
                # viver; quando a sessão acaba (com ou sem erro), são canceladas.
                background = [
                    asyncio.create_task(self._status_logger()),
                    asyncio.create_task(self._inventory_logger()),
                    asyncio.create_task(self._hunt_queue_loop()),
                ]
                if self.acc.auto_catch:
                    background.append(asyncio.create_task(self.balls.run_forever()))
                if self.restockers:
                    background.append(asyncio.create_task(self._auto_restock_loop()))

                recv_task = asyncio.create_task(self._recv_loop(ws))
                try:
                    await recv_task
                finally:
                    self.market.unbind()
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
                self._check_erro(msg)
                if msg.get("t") == "sessao.renovada" and msg.get("token"):
                    # O jogo renova o token da sessão; sem guardar o novo, o antigo vence.
                    self.acc = replace(self.acc, token=str(msg["token"]))
                    if self.on_token_renewed:
                        self.on_token_renewed(self.acc.index, self.acc.token)
                    continue
                self.hunt.handle_frame(msg)
                self.balls.handle_frame(msg)
                self.shop.handle_frame(msg)
                self.market.handle_frame(msg)
                self._check_server_rares()
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

    # Itens raros do próprio servidor (Mystery Egg, fichas novas...): ids >= 70000 marcados como raros no
    # `welcome.itensNossos`. Os 4 acompanhados em session_stats têm tratamento próprio; o Boss Token não avisa.
    _NOT_RARE_CATEGORIES = frozenset({"stone", "heal", "revive"})

    def _rare_counts(self) -> dict[int, int]:
        skip = {i for ids in TRACKED.values() for i in ids}
        out: dict[int, int] = {}
        for raw_id, qty in (self.estado.get("items") or {}).items():
            try:
                iid, qty = int(raw_id), int(qty)
            except (TypeError, ValueError):
                continue
            if iid < 70000 or iid in skip:
                continue
            nos = self.itens_nossos.get(iid) or {}
            if nos.get("rare") is False or nos.get("category") in self._NOT_RARE_CATEGORIES:
                continue
            out[iid] = qty
        return out

    def _check_server_rares(self) -> None:
        if self._rare_last is None:
            return
        now = self._rare_counts()
        for iid, qty in now.items():
            n = qty - self._rare_last.get(iid, 0)
            if n <= 0:
                continue
            nos = self.itens_nossos.get(iid) or {}
            label = nos.get("name") or item_name(iid)
            key = f"i{iid}"
            ITEM_LABELS[key] = label
            total = self.daily.add_item(self.acc.nick, key, n) if self.daily else n
            icon = nos.get("icon")
            thumb = None
            if icon:
                thumb = "https://pokeidle.io" + (icon if str(icon).startswith("/") else f"/assets/{icon}")
            self.notifier.send(self.acc.nick, f"💎 pegou **{n}× {label}**", GOLD,
                               [("Total no dia", str(total), True)], thumbnail=thumb)
        self._rare_last = now

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

    # ----------------------------------------------------------- comandos do painel
    @property
    def can_send(self) -> bool:
        return self.state == State.ONLINE and self.hunt._ws is not None

    async def set_automation(self, patch: dict) -> None:
        """auto.set (confirmado em conta real): clona a automação atual inteira, troca só `patch` e envia.
        Nunca monta o frame do zero: campos que o painel não edita seguem como o jogo os mandou."""
        if not self.can_send:
            raise RuntimeError("conta offline")
        current = dict(self.estado.get("automation") or {})
        await self.hunt._ws.send(json.dumps({"t": "auto.set", **current, **patch}))
        log.info("[%s] auto.set %s enviado", self.acc.name, sorted(patch))

    def combat_lock_ms(self) -> int:
        """Quanto falta (ms) para a conta poder trocar de hunt/ir ao Center. `estado.centroLivreEm` é a hora do
        servidor em que a trava de combate acaba (docs/02); cada hit recebido a reinicia."""
        free_at = self.estado.get("centroLivreEm")
        if not isinstance(free_at, (int, float)):
            return 0
        return max(0, int(free_at) - self.market.server_now_ms())

    def queue_hunt(self, slug: str | None) -> None:
        """Guarda a hunt desejada: troca sozinha assim que a trava de combate acabar (None cancela)."""
        self.pending_hunt = slug
        log.info("[%s] hunt na fila: %s", self.acc.name, slug)

    async def _hunt_queue_loop(self) -> None:
        """Envia `hunt.select` da hunt na fila quando a trava de combate acaba e só dá a fila por cumprida
        quando o jogo confirma (evento `hunt`). Se o jogo ignorar (ex.: um hit chegou na hora), tenta de novo."""
        attempts = 0
        while True:
            await asyncio.sleep(0.25)
            slug = self.pending_hunt
            if not slug:
                attempts = 0
                continue
            s = self.hunt.session
            if s is not None and s.slug == slug:
                self.pending_hunt = None
                continue
            if self.combat_lock_ms() > 0 or not self.can_send:
                continue
            try:
                await self.hunt.select_hunt(slug)
            except Exception as e:  # conexão caiu no envio: a fila continua e tenta de novo quando voltar
                log.warning("[%s] não consegui enviar a hunt da fila (%s)", self.acc.name, type(e).__name__)
                await asyncio.sleep(1)
                continue
            attempts += 1
            for _ in range(24):  # até 6s pela confirmação
                await asyncio.sleep(0.25)
                s = self.hunt.session
                if (s is not None and s.slug == slug) or self.pending_hunt != slug:
                    break
            else:
                if attempts >= 4:
                    log.warning("[%s] o jogo não aceitou a hunt %s após %d tentativas; fila cancelada",
                                self.acc.name, slug, attempts)
                    self.pending_hunt = None
                    attempts = 0
                continue
            if self.pending_hunt == slug:
                self.pending_hunt = None
            attempts = 0

    async def restock_now(self, kind: str) -> None:
        """Roda já a reposição de `kind` ("item" = poção, "ball"), sem esperar o próximo ciclo
        (usado logo após trocar poção/bola no painel). Só mexe no tipo pedido."""
        for r in self.restockers:
            if r.kind == kind:
                r._last_try.clear()
                await r.check_and_restock()

    # ----------------------------------------------------------- supervisor
    async def run_forever(self) -> None:
        """Mantém a conta conectada; aplica cooldown de 5 min em rejeição."""
        while True:
            try:
                await self._session()
                self._set(State.DISCONNECTED, "sessão encerrada", "servidor encerrou a sessão")
            except AccountBlocked as e:
                self.block = {"kind": e.kind, "detail": e.detail}
                self.last_reason = e.detail
                self._set(State.BLOCKED, e.detail, e.detail)
                if self.on_auth_status:
                    self.on_auth_status(self.acc.index, e.kind, e.detail)
                while True:  # só o painel (editar/reiniciar a conta) tira daqui, cancelando a task
                    await asyncio.sleep(3600)
            except NetworkFull:
                self.last_reason = "rede no limite de contas online"
                self._set(State.DISCONNECTED, f"rede cheia; nova tentativa em {NETWORK_FULL_RETRY_S}s",
                          "rede no limite de contas online")
                await asyncio.sleep(NETWORK_FULL_RETRY_S)
                continue
            except AuthRejected as e:
                self.last_reason = str(e)
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

"""Carregamento de configuração (.env) para até 4 contas.

Variáveis globais:
    WS_URL                  URL wss:// do servidor do jogo (NÃO consta na spec; obrigatória)
    EXTERNAL_LOGIN_CLOSE_CODES  close codes que indicam login externo (default: 4001,4003,1008)

Variáveis por conta (N = 1..4). Conta só é ativada se ACCn_TOKEN existir:
    ACCn_NICK, ACCn_TOKEN, ACCn_DEVICE_ID
    ACCn_PROXY_SCHEME  (http | socks5 | socks5h)
    ACCn_PROXY_HOST, ACCn_PROXY_PORT, ACCn_PROXY_USER, ACCn_PROXY_PASS
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import quote

from dotenv import load_dotenv

MAX_ACCOUNTS = 4

# Parâmetros de protocolo (spec: spec do protocolo + requisitos do usuário)
WELCOME_TIMEOUT = 15      # s esperando 'welcome' após 'hello'
PING_INTERVAL = 30        # s entre pings
PING_TIMEOUT = 90         # s sem resposta -> conexão considerada morta
COOLDOWN_SECONDS = 300    # PAUSED_COOLDOWN (5 min)
RECONNECT_DELAY = 10      # s de espera em quedas comuns (rede)
STATUS_LOG_INTERVAL = 30     # s entre linhas de status da hunt (Pokémon/HP/XP-h/Gold-h)
INVENTORY_LOG_INTERVAL = 300 # s entre relatórios detalhados de inventário (5 min)

# spec do protocolo: janela de captura do cadáver (~30s) e cooldown
# mínimo entre ball.throw (1200ms); aplicamos uma margem de segurança.
CORPSE_WINDOW_S = 30
BALL_THROW_COOLDOWN_S = 1.3
DEFAULT_BALL_PRIORITY = [1, 2, 3, 4]  # preferência local; doc não define prioridade

# spec do protocolo: restock de poção equipada (heldItemId do Pokémon ativo)
# Compra QTY unidades sempre que o estoque ficar ABAIXO de THRESHOLD (Potion e Ball equipadas).
DEFAULT_POTION_RESTOCK_THRESHOLD = 10
DEFAULT_POTION_RESTOCK_QTY = 100
DEFAULT_BALL_RESTOCK_THRESHOLD = 10
DEFAULT_BALL_RESTOCK_QTY = 100
POTION_CHECK_INTERVAL_S = 5   # intervalo do check de reposição (Potion e Ball)

VALID_SCHEMES = {"http", "https", "socks5", "socks5h", "socks4"}


@dataclass(frozen=True)
class ProxyConfig:
    scheme: str
    host: str
    port: int
    username: str
    password: str

    @property
    def url(self) -> str:
        """URL completa com credenciais URL-encoded (uso interno; nunca logar)."""
        auth = ""
        if self.username:
            auth = quote(self.username, safe="")
            if self.password:
                auth += ":" + quote(self.password, safe="")
            auth += "@"
        return f"{self.scheme}://{auth}{self.host}:{self.port}"

    @property
    def label(self) -> str:
        """Representação segura para logs (sem credenciais)."""
        return f"{self.scheme}://{self.host}:{self.port}"


@dataclass(frozen=True)
class AccountConfig:
    index: int
    nick: str
    token: str
    device_id: str
    proxy: ProxyConfig | None  # None = conexão direta (sem proxy), só para testes
    hunt_slug: str | None = None  # opcional; se definido, seleciona essa hunt ao conectar
    auto_catch: bool = True          # captura automática (ball.throw) em cadáveres válidos
    ball_priority: tuple[int, ...] = tuple(DEFAULT_BALL_PRIORITY)  # ordem de preferência de ballId
    auto_potion: bool = True         # reposição automática de Potion
    potion_id: int | None = None     # qual Potion repor; None = fallback por heldItemId
    potion_restock_threshold: int = DEFAULT_POTION_RESTOCK_THRESHOLD
    potion_restock_qty: int = DEFAULT_POTION_RESTOCK_QTY
    auto_ball_restock: bool = True   # reposição automática da Ball equipada
    ball_id: int | None = None       # qual Ball repor; None = automation.ballIds do jogo
    ball_restock_threshold: int = DEFAULT_BALL_RESTOCK_THRESHOLD
    ball_restock_qty: int = DEFAULT_BALL_RESTOCK_QTY

    @property
    def name(self) -> str:
        return f"ACC{self.index}:{self.nick}"


@dataclass(frozen=True)
class Settings:
    ws_url: str
    external_login_codes: frozenset[int]
    accounts: list[AccountConfig]


def _load_account(i: int) -> AccountConfig | None:
    p = f"ACC{i}_"
    token = os.getenv(p + "TOKEN", "").strip()
    if not token:
        return None  # slot não configurado

    def req(key: str) -> str:
        val = os.getenv(p + key, "").strip()
        if not val:
            raise ValueError(f"Variável obrigatória ausente: {p}{key}")
        return val

    proxy_host = os.getenv(p + "PROXY_HOST", "").strip()
    proxy: ProxyConfig | None = None
    if proxy_host:
        scheme = os.getenv(p + "PROXY_SCHEME", "socks5").strip().lower()
        if scheme not in VALID_SCHEMES:
            raise ValueError(f"{p}PROXY_SCHEME inválido: {scheme} (use {sorted(VALID_SCHEMES)})")
        proxy = ProxyConfig(
            scheme=scheme,
            host=proxy_host,
            port=int(req("PROXY_PORT")),
            username=os.getenv(p + "PROXY_USER", ""),
            password=os.getenv(p + "PROXY_PASS", ""),
        )
    hunt_slug = os.getenv(p + "HUNT_SLUG", "").strip() or None

    def flag(key: str, default: bool) -> bool:
        val = os.getenv(p + key, "").strip().lower()
        return default if not val else val in ("1", "true", "yes", "on")

    ball_priority_raw = os.getenv(p + "BALL_PRIORITY", "").strip()
    ball_priority = (tuple(int(x) for x in ball_priority_raw.split(",") if x.strip())
                     if ball_priority_raw else tuple(DEFAULT_BALL_PRIORITY))

    return AccountConfig(
        i, req("NICK"), token, req("DEVICE_ID"), proxy, hunt_slug,
        auto_catch=flag("AUTO_CATCH", True),
        ball_priority=ball_priority,
        auto_potion=flag("AUTO_POTION", True),
        potion_id=(int(os.getenv(p + "POTION_ID", "").strip())
                  if os.getenv(p + "POTION_ID", "").strip() else None),
        potion_restock_threshold=int(os.getenv(p + "POTION_RESTOCK_THRESHOLD",
                                                str(DEFAULT_POTION_RESTOCK_THRESHOLD))),
        potion_restock_qty=int(os.getenv(p + "POTION_RESTOCK_QTY",
                                         str(DEFAULT_POTION_RESTOCK_QTY))),
        auto_ball_restock=flag("AUTO_BALL_RESTOCK", True),
        ball_id=(int(os.getenv(p + "BALL_ID", "").strip())
                 if os.getenv(p + "BALL_ID", "").strip() else None),
        ball_restock_threshold=int(os.getenv(p + "BALL_RESTOCK_THRESHOLD",
                                             str(DEFAULT_BALL_RESTOCK_THRESHOLD))),
        ball_restock_qty=int(os.getenv(p + "BALL_RESTOCK_QTY",
                                       str(DEFAULT_BALL_RESTOCK_QTY))),
    )


def load_settings(env_file: str | None = None) -> Settings:
    load_dotenv(env_file)
    ws_url = os.getenv("WS_URL", "").strip()
    if not ws_url.startswith(("ws://", "wss://")):
        raise ValueError("WS_URL ausente ou inválida (deve começar com ws:// ou wss://)")

    codes = os.getenv("EXTERNAL_LOGIN_CLOSE_CODES", "4001,4003,1008")
    code_set = frozenset(int(c) for c in codes.split(",") if c.strip())

    accounts = [a for i in range(1, MAX_ACCOUNTS + 1) if (a := _load_account(i))]
    if not accounts:
        raise ValueError("Nenhuma conta configurada (defina ACC1_TOKEN, ...)")
    return Settings(ws_url, code_set, accounts)

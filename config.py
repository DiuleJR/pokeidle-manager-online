"""Configuração: modelos de conta/proxy e leitura do .env.

As contas e as configurações do painel vivem no banco (store.py). O .env só é
lido para (a) o bootstrap do servidor (host/porta/token do painel) e (b) importar
as contas ACCn_* na primeira execução, para quem já usava o formato antigo.

Variáveis globais (opcionais):
    WS_URL                  URL wss:// do servidor do jogo (padrão: wss://pokeidle.io)
    EXTERNAL_LOGIN_CLOSE_CODES  close codes que indicam login externo (default: 4001,4003,1008)

Variáveis por conta (N = 1..4). Conta só é importada se ACCn_TOKEN existir:
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
DEFAULT_WS_URL = "wss://pokeidle.io"

# Parâmetros de protocolo (spec: spec do protocolo + requisitos do usuário)
WELCOME_TIMEOUT = 15      # s esperando 'welcome' após 'hello'
PING_INTERVAL = 30        # s entre pings
PING_TIMEOUT = 90         # s sem resposta -> conexão considerada morta
FRAME_SILENCE_S = 150     # s sem NENHUM frame do jogo com hunt ativa -> sessão travada: reconecta
FRAME_CHECK_S = 15        # s entre verificações do vigia de frames
EXTERNAL_LOGIN_WAIT_MIN = 5   # min de espera antes de reconectar uma conta aberta em outro lugar (configurável no painel)
DOWN_ALERT_DELAY_S = 120  # s: queda que volta antes disso não avisa no Discord (o jogo reinicia o servidor várias vezes por dia)
COOLDOWN_SECONDS = 300    # PAUSED_COOLDOWN (5 min)
RECONNECT_DELAY = 10      # s entre tentativas quando o servidor não responde (manutenção, rede fora)
MIN_UPTIME_FOR_FAST_RETRY_S = 5  # sessão que durou isso ou mais e caiu: 1ª nova tentativa é imediata
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


# Opções por conta (guardadas no banco como JSON) e seus padrões.
OPTION_DEFAULTS: dict = {
    "hunt_slug": "",
    "auto_catch": True,
    "ball_priority": list(DEFAULT_BALL_PRIORITY),
    "auto_potion": True,
    "potion_id": None,
    "potion_restock_threshold": DEFAULT_POTION_RESTOCK_THRESHOLD,
    "potion_restock_qty": DEFAULT_POTION_RESTOCK_QTY,
    "auto_ball_restock": True,
    "ball_id": None,
    "ball_restock_threshold": DEFAULT_BALL_RESTOCK_THRESHOLD,
    "ball_restock_qty": DEFAULT_BALL_RESTOCK_QTY,
}


def build_account_config(d: dict) -> AccountConfig:
    """Monta o AccountConfig de runtime a partir de um dict de conta (formato do store)."""
    proxy: ProxyConfig | None = None
    p = d.get("proxy") or {}
    if p.get("host"):
        scheme = (p.get("scheme") or "socks5").strip().lower()
        if scheme not in VALID_SCHEMES:
            raise ValueError(f"proxy: esquema inválido {scheme!r} (use {sorted(VALID_SCHEMES)})")
        proxy = ProxyConfig(scheme=scheme, host=str(p["host"]).strip(), port=int(p["port"]),
                            username=p.get("username") or "", password=p.get("password") or "")
    o = {**OPTION_DEFAULTS, **(d.get("options") or {})}
    prio = o["ball_priority"]
    if isinstance(prio, str):
        prio = [x for x in prio.split(",") if x.strip()]
    return AccountConfig(
        index=int(d["id"]), nick=d["nick"], token=d["token"], device_id=d["device_id"],
        proxy=proxy, hunt_slug=(o["hunt_slug"] or None),
        auto_catch=bool(o["auto_catch"]),
        ball_priority=tuple(int(x) for x in prio) or tuple(DEFAULT_BALL_PRIORITY),
        auto_potion=bool(o["auto_potion"]),
        potion_id=int(o["potion_id"]) if o["potion_id"] not in (None, "") else None,
        potion_restock_threshold=int(o["potion_restock_threshold"]),
        potion_restock_qty=int(o["potion_restock_qty"]),
        auto_ball_restock=bool(o["auto_ball_restock"]),
        ball_id=int(o["ball_id"]) if o["ball_id"] not in (None, "") else None,
        ball_restock_threshold=int(o["ball_restock_threshold"]),
        ball_restock_qty=int(o["ball_restock_qty"]),
    )


def _env_account(i: int) -> dict | None:
    """Lê ACCi_* do ambiente no formato de dict do store. None = slot vazio."""
    p = f"ACC{i}_"
    token = os.getenv(p + "TOKEN", "").strip()
    if not token:
        return None  # slot não configurado

    def req(key: str) -> str:
        val = os.getenv(p + key, "").strip()
        if not val:
            raise ValueError(f"Variável obrigatória ausente: {p}{key}")
        return val

    def num(key: str) -> int | None:
        val = os.getenv(p + key, "").strip()
        return int(val) if val else None

    def flag(key: str, default: bool) -> bool:
        val = os.getenv(p + key, "").strip().lower()
        return default if not val else val in ("1", "true", "yes", "on")

    proxy = None
    host = os.getenv(p + "PROXY_HOST", "").strip()
    if host:
        proxy = {"scheme": os.getenv(p + "PROXY_SCHEME", "socks5").strip().lower(),
                 "host": host, "port": int(req("PROXY_PORT")),
                 "username": os.getenv(p + "PROXY_USER", ""),
                 "password": os.getenv(p + "PROXY_PASS", "")}
    prio_raw = os.getenv(p + "BALL_PRIORITY", "").strip()
    options = {
        "hunt_slug": os.getenv(p + "HUNT_SLUG", "").strip(),
        "auto_catch": flag("AUTO_CATCH", True),
        "ball_priority": ([int(x) for x in prio_raw.split(",") if x.strip()]
                          if prio_raw else list(DEFAULT_BALL_PRIORITY)),
        "auto_potion": flag("AUTO_POTION", True),
        "potion_id": num("POTION_ID"),
        "potion_restock_threshold": num("POTION_RESTOCK_THRESHOLD") or DEFAULT_POTION_RESTOCK_THRESHOLD,
        "potion_restock_qty": num("POTION_RESTOCK_QTY") or DEFAULT_POTION_RESTOCK_QTY,
        "auto_ball_restock": flag("AUTO_BALL_RESTOCK", True),
        "ball_id": num("BALL_ID"),
        "ball_restock_threshold": num("BALL_RESTOCK_THRESHOLD") or DEFAULT_BALL_RESTOCK_THRESHOLD,
        "ball_restock_qty": num("BALL_RESTOCK_QTY") or DEFAULT_BALL_RESTOCK_QTY,
    }
    return {"id": i, "nick": req("NICK"), "token": token, "device_id": req("DEVICE_ID"),
            "proxy": proxy, "options": options}


def load_env_accounts() -> list[dict]:
    """Contas ACC1..ACC4 do ambiente (formato antigo), para importar no banco."""
    return [a for i in range(1, MAX_ACCOUNTS + 1) if (a := _env_account(i))]


def parse_close_codes() -> frozenset[int]:
    codes = os.getenv("EXTERNAL_LOGIN_CLOSE_CODES", "4001,4003,1008")
    return frozenset(int(c) for c in codes.split(",") if c.strip())


def down_alert_delay() -> float:
    """Segundos fora antes de avisar 'Caiu' no Discord. DOWN_ALERT_DELAY_S no .env muda (0 = avisa toda queda)."""
    try:
        return max(0.0, float(os.getenv("DOWN_ALERT_DELAY_S", DOWN_ALERT_DELAY_S)))
    except ValueError:
        return float(DOWN_ALERT_DELAY_S)


_external_login_wait_min = float(EXTERNAL_LOGIN_WAIT_MIN)


def set_external_login_wait_min(minutes) -> None:
    """Define (em minutos) quanto esperar antes de reconectar uma conta aberta em outro lugar. Valor inválido = padrão."""
    global _external_login_wait_min
    try:
        v = float(minutes)
    except (TypeError, ValueError):
        v = float(EXTERNAL_LOGIN_WAIT_MIN)
    _external_login_wait_min = min(max(v, 1.0), 1440.0)


def external_login_wait_s() -> float:
    return _external_login_wait_min * 60

"""PVP ranqueado: acompanha o rank da conta e entra sozinho na fila de partidas.

Protocolo (lido do cliente do jogo; ver docs/12-pvp.md):
    Cliente -> Servidor   pvp.info {semLadder:1}   rank, time, regras, histórico, fila
                          pvp.fila.entrar          entra na fila (a partida é simulada no servidor)
                          pvp.fila.sair            sai da fila
                          pvp.partida.vista {id}   confirma que a partida foi vista
                          pvp.tabela {pagina}      página da tabela (Top 1.000)
    Servidor -> Cliente   pvp {rank, time, regras, historico, fila, partida, filaRecusa, ...}
                          pvpTabela {...}

O jogo só libera "Fila automática" para VIP. Aqui o painel faz o mesmo para qualquer conta: quando a opção está
ligada, entra na fila assim que a espera entre partidas acaba. Nada disso mexe na hunt da conta.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

import config

log = logging.getLogger("pvp")

LEVEL_MIN = 150               # PVP_NIVEL_MIN do jogo (o servidor manda o valor real em `regras.nivelMin`)
TEAM_MAX = 5
BETWEEN_MATCHES_S = 20.0      # PVP_ENTRE_PARTIDAS_MS
TICK_S = 1.0
IDLE_TICK_S = 15.0           # passo do laço com o automático desligado (só confere se é hora de renovar o rank)
ENTER_GAP_S = 4.0             # mínimo entre dois pedidos de entrada (o servidor pode demorar a confirmar)
CONFIRM_S = 12.0              # sem confirmação da fila nesse tempo, pede de novo
REFUSE_BACKOFF_S = 45.0       # recusa sem prazo informado
REFUSE_BACKOFF_MAX_S = 600.0
INFO_EVERY_S = 90.0           # atualiza o rank de vez em quando (decaimento, posição)
HISTORY_KEEP = 20
RECENT_KEEP = 30


def _num(v, default=0):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else default


class PvpManager:
    def __init__(self, account_name: str, estado: dict, auto: bool = False) -> None:
        self.account_name = account_name
        self.estado = estado
        self._wake = asyncio.Event()    # acorda o laço quando o automático liga (sem ficar conferindo a cada segundo)
        self._auto = auto
        self._ws = None
        self._seen_shapes: set[tuple] = set()
        self._reset()

    @property
    def auto(self) -> bool:
        return self._auto

    @auto.setter
    def auto(self, on: bool) -> None:
        self._auto = on
        self._wake.set()

    @property
    def native_auto(self) -> bool:
        return self._native_auto

    @native_auto.setter
    def native_auto(self, on: bool) -> None:
        self._native_auto = on
        self._wake.set()

    def _reset(self) -> None:
        self.rank: dict | None = None
        self.position: int | None = None
        self.total_ranked: int | None = None
        self.final_position: int | None = None   # posição "se a semana acabasse agora"
        self.final_cut: int | None = None        # PR do último lugar premiado (Top 100)
        self.rank_at = 0                         # ms epoch do último rank recebido
        self.rules: dict = {}
        self.team: list[int] = []
        self.houses: dict = {}
        self.history: list[dict] = []
        self.queue: dict = {"na": False, "desde": 0, "tamanho": 0}
        self.queue_local_since = 0.0           # monotonic de quando a fila passou a valer aqui
        self.wait_until = 0.0                  # monotonic: espera entre partidas
        self.last_enter = 0.0
        self.last_info = 0.0
        self.refusal: dict | None = None       # {msg, at}
        self.refusals_in_row = 0
        self.native_auto = False               # a "fila automática" do jogo (VIP) está ligada
        self.matches: list[dict] = []          # partidas vistas nesta sessão (mais recente primeiro)
        self.wins = 0
        self.losses = 0
        self.delta = 0
        self.ready = False
        self._pending_enter = False
        self._save_waiters: list[asyncio.Future] = []

    # --------------------------------------------------------------- conexão
    def bind(self, ws) -> None:
        self._ws = ws
        self._reset_connection()
        self.load_from_estado()

    def unbind(self) -> None:
        self._ws = None

    def _reset_connection(self) -> None:
        self.queue = {"na": False, "desde": 0, "tamanho": 0}
        self.refusal = None
        self.refusals_in_row = 0
        self.last_info = 0.0
        self._pending_enter = False

    def load_from_estado(self) -> None:
        """O `welcome` já traz o rank e o time; o resto chega com o primeiro `pvp.info`."""
        e = self.estado
        if isinstance(e.get("pvp"), dict):
            self.rank = dict(e["pvp"])
        if isinstance(e.get("pvpTime"), list):
            self.team = [int(i) for i in e["pvpTime"] if isinstance(i, (int, float))][:TEAM_MAX]
        if isinstance(e.get("pvpFila"), dict):
            self.queue = {**self.queue, **e["pvpFila"]}
        auto = e.get("automation")
        self.native_auto = bool(isinstance(auto, dict) and auto.get("pvpAutoFila"))

    async def _send(self, frame: dict) -> bool:
        if self._ws is None:
            return False
        try:
            await self._ws.send(json.dumps(frame, ensure_ascii=False))
            return True
        except Exception as e:      # conexão caindo: o supervisor reconecta, aqui só desiste desta tentativa
            log.warning("[%s] pvp: não consegui enviar %s (%s)", self.account_name, frame.get("t"), type(e).__name__)
            return False

    async def request_info(self) -> None:
        self.last_info = time.monotonic()
        await self._send({"t": "pvp.info", "semLadder": 1})

    # ---------------------------------------------------------------- frames
    def handle_frame(self, msg: dict) -> None:
        t = msg.get("t")
        if t == "estado":
            auto = (msg.get("automation") if isinstance(msg.get("automation"), dict) else None)
            if auto is not None:
                self.native_auto = bool(auto.get("pvpAutoFila"))
            return
        if t != "pvp":
            return
        sig = tuple(sorted(msg))
        if sig not in self._seen_shapes and len(self._seen_shapes) < 40:   # amostra de cada formato, para o diagnóstico
            self._seen_shapes.add(sig)
            log.info("[%s] pvp frame %s: %s", self.account_name, list(sig), json.dumps(msg, ensure_ascii=False)[:700])
        if isinstance(msg.get("rank"), dict):
            self.rank = msg["rank"]
        if "posicao" in msg:
            self.position = msg["posicao"] if isinstance(msg["posicao"], int) else None
        if "posicaoFinal" in msg:
            self.final_position = msg["posicaoFinal"] if isinstance(msg["posicaoFinal"], int) else None
        if "corteFinal" in msg:
            self.final_cut = msg["corteFinal"] if isinstance(msg["corteFinal"], (int, float)) else None
        if isinstance(msg.get("rank"), dict):
            self.rank_at = int(time.time() * 1000)
        if "totalClassificados" in msg:
            self.total_ranked = msg["totalClassificados"] if isinstance(msg["totalClassificados"], int) else None
        if isinstance(msg.get("regras"), dict):
            self.rules = msg["regras"]
        if isinstance(msg.get("time"), list):
            self.team = [int(i) for i in msg["time"] if isinstance(i, (int, float))][:TEAM_MAX]
        if isinstance(msg.get("timeSalvo"), list):
            self.team = [int(i) for i in msg["timeSalvo"] if isinstance(i, (int, float))][:TEAM_MAX]
        if isinstance(msg.get("casas"), dict):
            self.houses = msg["casas"]
        if isinstance(msg.get("casasSalvas"), dict):
            self.houses = msg["casasSalvas"]
        if "timeSalvo" in msg:
            self._finish_save(None)
        elif msg.get("recusa"):
            rec = msg["recusa"]
            self._finish_save(str(rec.get("msg") if isinstance(rec, dict) else rec) or "O jogo recusou a equipe.")
        if isinstance(msg.get("historico"), list):
            self.history = [h for h in msg["historico"] if isinstance(h, dict)][:HISTORY_KEEP]
        if isinstance(msg.get("fila"), dict):
            self.queue = {**self.queue, **msg["fila"]}
            cd = msg["fila"].get("cooldownMs")
            if isinstance(cd, (int, float)):
                self.wait_until = time.monotonic() + max(0.0, cd) / 1000
            if self.queue.get("na"):
                self._pending_enter = False
                self.refusals_in_row = 0
                self.refusal = None
        rec = msg.get("filaRecusa")
        if rec:
            self._on_refusal(rec)
        if msg.get("filaAutoDesligada"):
            self.native_auto = False
        if msg.get("filaAuto") or msg.get("filaRetomada"):
            self._pending_enter = False
        if isinstance(msg.get("partida"), dict):
            self._on_match(msg["partida"])

    def _on_refusal(self, rec) -> None:
        self.queue = {**self.queue, "na": False, "desde": 0}
        self._pending_enter = False
        text = rec.get("msg") if isinstance(rec, dict) else str(rec)
        rest = _num(rec.get("restaMs")) if isinstance(rec, dict) else 0
        self.refusals_in_row += 1
        if rest > 0:
            delay = rest / 1000 + 0.5
        else:
            delay = min(REFUSE_BACKOFF_MAX_S, REFUSE_BACKOFF_S * (2 ** (self.refusals_in_row - 1)))
        self.wait_until = max(self.wait_until, time.monotonic() + delay)
        self.refusal = {"msg": str(text or ""), "at": int(time.time() * 1000)}
        log.info("[%s] pvp: fila recusada (%s); nova tentativa em %.0fs", self.account_name, text, delay)

    def _on_match(self, p: dict) -> None:
        won = bool(p.get("venci"))
        delta = int(_num(p.get("delta")))
        opp = p.get("oponente")
        nick = opp.get("nick") if isinstance(opp, dict) else (opp if isinstance(opp, str) else "")
        self.queue = {**self.queue, "na": False, "desde": 0}
        self._pending_enter = False
        self.refusals_in_row = 0
        self.refusal = None
        self.wait_until = time.monotonic() + BETWEEN_MATCHES_S
        if isinstance(self.rank, dict):
            self.rank = {**self.rank, "pontos": _num(p.get("pontos"), self.rank.get("pontos", 0)),
                         "partidas": _num(self.rank.get("partidas")) + 1,
                         "vitorias": _num(self.rank.get("vitorias")) + (1 if won else 0),
                         "derrotas": _num(self.rank.get("derrotas")) + (0 if won else 1)}
        if isinstance(p.get("posicao"), int):
            self.position = p["posicao"]
        self.wins += 1 if won else 0
        self.losses += 0 if won else 1
        self.delta += delta
        self.matches.insert(0, {"id": p.get("id"), "won": won, "delta": delta, "opponent": str(nick or ""),
                                "points": p.get("pontos"), "at": int(time.time() * 1000)})
        del self.matches[RECENT_KEEP:]
        log.info("[%s] pvp: %s contra %s (%+d)", self.account_name, "vitória" if won else "derrota", nick, delta)
        # O cliente do jogo confirma a partida e atualiza o rank logo depois; sem isso o jogo a trata como não vista.
        if p.get("id") is not None:
            asyncio.get_running_loop().create_task(self._after_match(p["id"]))

    async def _after_match(self, match_id) -> None:
        await self._send({"t": "pvp.partida.vista", "id": match_id})
        await self.request_info()

    def _finish_save(self, error: str | None) -> None:
        for fut in self._save_waiters:
            if not fut.done():
                fut.set_result(error)
        self._save_waiters.clear()

    async def save_team(self, ids: list[int], houses: dict[str, int], timeout: float = 10.0) -> str | None:
        """Salva a equipe do PVP (frame `pvp.time.salvar`) e espera o jogo confirmar. Devolve o erro, ou None se salvou."""
        fut = asyncio.get_running_loop().create_future()
        self._save_waiters.append(fut)
        if not await self._send({"t": "pvp.time.salvar", "pokemonIds": ids, "casas": houses}):
            self._save_waiters.remove(fut)
            return "Conta offline."
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            return "O jogo não confirmou a equipe. Confira no jogo."
        finally:
            if fut in self._save_waiters:
                self._save_waiters.remove(fut)

    # ------------------------------------------------------------- consultas
    @property
    def level_min(self) -> int:
        return int(_num(self.rules.get("nivelMin"), LEVEL_MIN))

    def wait_ms(self) -> int:
        return max(0, int((self.wait_until - time.monotonic()) * 1000))

    def blocker(self, level: int) -> str | None:
        """Por que não dá para entrar na fila agora (None = pode)."""
        if self._ws is None:
            return "offline"
        if level < self.level_min:
            return "level"
        if not self.team:
            return "team"
        return None

    # ------------------------------------------------------------- comandos
    async def enter(self, level: int) -> str | None:
        """Pede a entrada na fila. Devolve o motivo se não der (ver `blocker`)."""
        why = self.blocker(level)
        if why:
            return why
        if self.queue.get("na"):
            return None
        self._pending_enter = True
        self.last_enter = time.monotonic()
        await self._send({"t": "pvp.fila.entrar"})
        return None

    async def leave(self) -> None:
        self._pending_enter = False
        await self._send({"t": "pvp.fila.sair"})

    # ------------------------------------------------------------------ loop
    async def run_forever(self, level_of) -> None:
        """Tarefa de fundo (vive enquanto a conexão viver). `level_of()` devolve o nível atual da conta."""
        await asyncio.sleep(2.0)
        await self.request_info()
        while True:
            if not config.economy_mode() or (self.auto and not self.native_auto):
                await asyncio.sleep(TICK_S)
            else:
                # Modo economia, com o automático desligado (ou feito pelo jogo): só renova o rank de vez em quando.
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=IDLE_TICK_S)
                except asyncio.TimeoutError:
                    pass
            try:
                await self._tick(level_of())
            except Exception:
                log.exception("[%s] pvp: falha no ciclo", self.account_name)
                await asyncio.sleep(5.0)

    async def _tick(self, level: int) -> None:
        now = time.monotonic()
        if now - self.last_info >= INFO_EVERY_S:
            await self.request_info()
        if not self.auto or self.native_auto:        # a fila automática do jogo (VIP) já faz o serviço
            return
        if self.queue.get("na"):
            return
        if self._pending_enter and now - self.last_enter < CONFIRM_S:
            return
        if now < self.wait_until or now - self.last_enter < ENTER_GAP_S:
            return
        if self.blocker(level):
            return
        await self.enter(level)

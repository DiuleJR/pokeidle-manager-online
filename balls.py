"""Captura automática (ball.throw), baseada exclusivamente em
spec do protocolo.

Regras da spec aplicadas aqui:
    - Após `batalha.ev[].k == "morte"` com `quem == "selvagem"`, o cadáver
      fica capturável por ~30s (CORPSE_WINDOW_S).
    - Cada `slot` permite só UMA tentativa de `ball.throw`; o resultado
      `k == "bola"` (sucesso ou falha) encerra a oportunidade daquele slot.
    - Cooldown mínimo confirmado entre lançamentos: 1200ms (aplicamos
      margem extra, BALL_THROW_COOLDOWN_S, pra não colidir com a validação
      do servidor).
    - Vários cadáveres válidos: prioridade FIFO (mais antigo primeiro).
    - `k == "fugiu"` é só informativo (não é obrigatório após toda falha).

A escolha de QUAL ballId usar quando há mais de um tipo em estoque não é
definida pela spec — é preferência local, configurável via
`ACCn_BALL_PRIORITY` (ex.: "4,1"). O padrão usa a ordem configurada em
`config.DEFAULT_BALL_PRIORITY`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

import config

log = logging.getLogger("balls")


class BallManager:
    def __init__(self, account_name: str, estado: dict, ball_priority: tuple[int, ...]):
        self.account_name = account_name
        self.estado = estado
        self.ball_priority = ball_priority
        self._ws = None
        self._corpses: dict[int, float] = {}   # slot -> deadline (time.monotonic())
        self._pending: set[int] = set()         # slots com ball.throw em voo
        self._last_throw_at = 0.0
        self.caught = 0
        self.failed = 0

    def bind(self, ws) -> None:
        """Associa a conexão WebSocket ativa (chamar a cada reconexão)."""
        self._ws = ws
        self._corpses.clear()
        self._pending.clear()

    # ------------------------------------------------------------ frames
    def handle_frame(self, msg: dict) -> None:
        if msg.get("t") != "batalha":
            return
        for ev in msg.get("ev", []):
            k = ev.get("k")
            if k == "morte" and ev.get("quem") == "selvagem":
                slot = ev.get("slot")
                if slot is not None:
                    self._corpses[slot] = time.monotonic() + config.CORPSE_WINDOW_S
            elif k == "bola":
                self._on_bola_result(ev)
            elif k == "fugiu":
                log.info("[%s] %s fugiu (lvl %s)", self.account_name,
                         ev.get("nome"), ev.get("level"))

    def _on_bola_result(self, ev: dict) -> None:
        slot = ev.get("slot")
        self._pending.discard(slot)
        self._corpses.pop(slot, None)  # resultado (sucesso ou falha) encerra a oportunidade
        if ev.get("sucesso"):
            self.caught += 1
            log.info("[%s] CAPTURADO slot=%s ballId=%s shiny=%s chance=%.1f%%",
                     self.account_name, slot, ev.get("ballId"), ev.get("shiny"),
                     (ev.get("chance") or 0) * 100)
        else:
            self.failed += 1
            log.info("[%s] falhou slot=%s ballId=%s chance=%.1f%%",
                     self.account_name, slot, ev.get("ballId"),
                     (ev.get("chance") or 0) * 100)

    # ----------------------------------------------------------- escolha
    def _pick_ball(self) -> int | None:
        """A bola que o jogo reporta como equipada (`estado.automation.ballIds`
        — mesmo campo usado pela reposição automática em shop.py e exibido no
        dashboard como "Bola equipada"), desde que haja estoque; cai para a
        prioridade local configurada (ACCn_BALL_PRIORITY) só se nenhuma bola
        da automação tiver estoque (ex.: welcome ainda não chegou).

        Antes disso, jogava sempre a primeira bola de ball_priority com
        estoque > 0 (Poké Ball por padrão), ignorando o que o jogo marca como
        equipado — por isso contas com estoque grande de Poké Ball nunca
        avançavam para a bola realmente equipada, e a reposição automática
        (que só vigia a bola da automação) parecia "não funcionar"."""
        balls = self.estado.get("balls", {})
        auto_ids = (self.estado.get("automation") or {}).get("ballIds") or []
        for bid in auto_ids:
            if balls.get(str(bid), 0) > 0:
                return bid
        for bid in self.ball_priority:
            if balls.get(str(bid), 0) > 0:
                return bid
        return None

    # ------------------------------------------------------------- loop
    async def run_forever(self) -> None:
        """Roda enquanto a conta estiver ONLINE; lança bolas respeitando
        cooldown global e janela de captura, com prioridade FIFO."""
        while True:
            await self._tick()
            await asyncio.sleep(0.2)

    async def _tick(self) -> None:
        now = time.monotonic()
        for slot in [s for s, deadline in self._corpses.items() if now > deadline]:
            del self._corpses[slot]  # janela de 30s expirou sem tentativa

        if now - self._last_throw_at < config.BALL_THROW_COOLDOWN_S:
            return

        # FIFO: cadáver com deadline mais próxima é o mais antigo.
        for slot, _ in sorted(self._corpses.items(), key=lambda kv: kv[1]):
            if slot in self._pending:
                continue
            ball_id = self._pick_ball()
            if ball_id is None:
                return  # sem bolas em estoque; tenta de novo no próximo tick
            await self._throw(slot, ball_id)
            return

    async def _throw(self, slot: int, ball_id: int) -> None:
        self._pending.add(slot)
        self._last_throw_at = time.monotonic()
        await self._ws.send(json.dumps({"t": "ball.throw", "ballId": ball_id, "slot": slot}))
        log.info("[%s] ball.throw ballId=%s slot=%s", self.account_name, ball_id, slot)

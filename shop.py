"""Compras na loja (shop.buy), baseado exclusivamente em spec do protocolo.

Regras da spec aplicadas:
    - `shop.buy` não confirma sucesso por si só; a confirmação autoritativa
      é `batalha.ev[].k == "compra"`.
    - Não calcular gasto pela diferença de `estado.gold` (a conta pode
      receber gold simultaneamente por kills/drops/venda automática);
      usar `compra.gasto`.
    - A automação deve aguardar `k:"compra"` antes de considerar a compra
      anterior concluída (aqui, antes de disparar a próxima).

IDs de Potion confirmados/mapeados pela doc (nível de confiança como na
spec: 200 é ✅ confirmado por frame; os demais são 🟡 mapeamento por ordem
da loja, ainda sem captura individual de compra):
    200 Small Potion    (✅)      201 Great Potion   (🟡)
    202 Ultra Potion    (🟡)      203 Hyper Potion   (🟡)
    204 Ultimate Potion (🟡)      70070 Golden Potion (🟡)

"Poção equipada" NÃO é um conceito definido em spec do protocolo ou spec do protocolo — foi
confirmado pelo usuário por observação direta (conta com Golden Potion
equipada em jogo tinha `heldItemId == 70070`), não por captura do
protocolo. Por isso o comportamento padrão é usar `heldItemId` do
Pokémon ativo (campo documentado em spec do protocolo) para
decidir qual Potion repor — assim o bot acompanha automaticamente se a
Potion equipada for trocada no jogo. `ACCn_POTION_ID` no `.env` existe
para fixar manualmente uma Potion específica quando preferir não depender
de `heldItemId` (ex.: conta sem Potion equipada ainda).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

import config

log = logging.getLogger("shop")

# spec do protocolo §15.7 — nível de confirmação indicado nos comentários acima.
KNOWN_POTION_IDS = {200, 201, 202, 203, 204, 70070}
# spec do protocolo §15.4: a Beast Ball (5) não é vendida na loja NPC.
BUYABLE_BALL_IDS = {1, 2, 3, 4}
BUY_CONFIRM_TIMEOUT_S = 20  # sem k:"compra" depois disso, libera a próxima tentativa
SELL_CONFIRM_TIMEOUT_S = 20  # sem k:"venda" depois disso, desiste de esperar


class ShopManager:
    def __init__(self, account_name: str, estado: dict):
        self.account_name = account_name
        self.estado = estado
        self._ws = None
        self._awaiting: tuple[str, int] | None = None  # (kind, id) aguardando k="compra"
        self._awaiting_since = 0.0
        self._pending_sell: asyncio.Future | None = None  # shop.sellAllPokemons aguardando k="venda"

    def bind(self, ws) -> None:
        self._ws = ws
        self._awaiting = None
        if self._pending_sell is not None and not self._pending_sell.done():
            self._pending_sell.set_exception(RuntimeError("conexão reiniciada antes da confirmação"))
        self._pending_sell = None

    # ------------------------------------------------------------ frames
    def handle_frame(self, msg: dict) -> None:
        if msg.get("t") != "batalha":
            return
        for ev in msg.get("ev", []):
            if ev.get("k") == "compra":
                log.info("[%s] compra confirmada: %s x%s (gasto=%s gold)",
                         self.account_name, ev.get("nome"), ev.get("qtd"), ev.get("gasto"))
                self._awaiting = None
            elif ev.get("k") == "venda":
                log.info("[%s] venda confirmada: %s (qtd=%s ganho=%s gold)",
                         self.account_name, ev.get("nome"), ev.get("qtd"), ev.get("ganho"))
                if self._pending_sell is not None and not self._pending_sell.done():
                    self._pending_sell.set_result({
                        "label": ev.get("nome"), "qty": ev.get("qtd"), "gained": ev.get("ganho"),
                    })

    # ----------------------------------------------------------- comando
    async def sell_all_pokemons(self) -> dict:
        """Cliente → Servidor: shop.sellAllPokemons (spec do protocolo §17). Vende
        todo o Depot (Pokémon não trancados/protegidos ficam preservados).

        AÇÃO IRREVERSÍVEL no jogo — a confirmação com o usuário é responsabilidade
        de quem chama (o dashboard mostra o aviso antes de enviar a requisição).
        Confirmação autoritativa: batalha.ev[].k == "venda"."""
        if self._ws is None:
            raise RuntimeError("conta offline")
        if self._pending_sell is not None and not self._pending_sell.done():
            raise RuntimeError("já há uma venda em andamento para esta conta")
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending_sell = fut
        await self._ws.send(json.dumps({"t": "shop.sellAllPokemons"}))
        log.info("[%s] shop.sellAllPokemons enviado", self.account_name)
        try:
            return await asyncio.wait_for(asyncio.shield(fut), timeout=SELL_CONFIRM_TIMEOUT_S)
        except asyncio.TimeoutError:
            raise RuntimeError("sem confirmação do servidor (timeout)") from None
        finally:
            if self._pending_sell is fut:
                self._pending_sell = None

    async def buy(self, kind: str, item_id: int, qty: int) -> bool:
        """Cliente → Servidor: shop.buy. Não dispara se já há uma compra em
        voo aguardando k:"compra" (spec: aguardar confirmação antes de
        considerar concluído)."""
        if self._ws is None:
            raise RuntimeError("ShopManager.bind(ws) não foi chamado")
        if self.awaiting_confirmation:
            return False
        self._awaiting = (kind, item_id)
        self._awaiting_since = time.monotonic()
        await self._ws.send(json.dumps({"t": "shop.buy", "kind": kind, "id": item_id, "qty": qty}))
        log.info("[%s] shop.buy kind=%s id=%s qty=%s enviado",
                 self.account_name, kind, item_id, qty)
        return True

    @property
    def awaiting_confirmation(self) -> bool:
        if self._awaiting is not None and time.monotonic() - self._awaiting_since > BUY_CONFIRM_TIMEOUT_S:
            log.warning("[%s] sem confirmação de compra de %s em %ss; liberando",
                        self.account_name, self._awaiting, BUY_CONFIRM_TIMEOUT_S)
            self._awaiting = None
        return self._awaiting is not None


class AutoRestock:
    """Repõe automaticamente um item (Potion ou Ball) quando o estoque cai
    ABAIXO de `threshold`, comprando sempre `qty` unidades.

    Quais IDs repor ("equipados"), em ordem de prioridade:
      Potion: 1) `ACCn_POTION_ID`; 2) `heldItemId` do Pokémon ativo (se for uma
              Potion conhecida; confirmado pela usuária); 3) `estado.automation.potionIds`.
      Ball:   1) `ACCn_BALL_ID`; 2) `estado.automation.ballIds` (Balls compráveis);
              3) primeira da prioridade de captura configurada.
    """

    RETRY_S = 30  # não repete a compra do mesmo ID antes disso (ex.: gold insuficiente)

    def __init__(self, account_name: str, estado: dict, shop: ShopManager, *, kind: str,
                 get_ids, threshold: int, qty: int):
        self.account_name = account_name
        self.estado = estado
        self.shop = shop
        self.kind = kind            # "item" (Potion) | "ball"
        self._get_ids = get_ids     # callable -> list[int]
        self.threshold = threshold
        self.qty = qty
        self._last_try: dict[int, float] = {}

    def _stock(self, item_id: int) -> int:
        bucket = "balls" if self.kind == "ball" else "items"
        return int((self.estado.get(bucket) or {}).get(str(item_id), 0) or 0)

    async def check_and_restock(self) -> None:
        if self.shop.awaiting_confirmation:
            return
        now = time.monotonic()
        for item_id in self._get_ids():
            stock = self._stock(item_id)
            if stock >= self.threshold or now - self._last_try.get(item_id, -1e9) < self.RETRY_S:
                continue
            self._last_try[item_id] = now
            if await self.shop.buy(self.kind, item_id, self.qty):
                log.info("[%s] estoque de %s id=%s baixo (%s < %s); comprando %s",
                         self.account_name, self.kind, item_id, stock, self.threshold, self.qty)
            return  # uma compra por vez (aguarda k:"compra")


def potion_ids_resolver(estado: dict, get_active_pokemon, potion_id: int | None):
    def resolve() -> list[int]:
        if potion_id is not None:
            return [potion_id]
        pk = get_active_pokemon()
        held = pk.get("heldItemId") if pk else None
        if held in KNOWN_POTION_IDS:
            return [held]
        return [i for i in (estado.get("automation") or {}).get("potionIds", []) if i in KNOWN_POTION_IDS]
    return resolve


def ball_ids_resolver(estado: dict, ball_priority, ball_id: int | None):
    def resolve() -> list[int]:
        if ball_id is not None:
            return [ball_id]
        ids = [i for i in (estado.get("automation") or {}).get("ballIds", []) if i in BUYABLE_BALL_IDS]
        if ids:
            return ids
        return [i for i in ball_priority if i in BUYABLE_BALL_IDS][:1]
    return resolve

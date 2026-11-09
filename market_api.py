"""Rotas do Mercado do painel: preços, anúncios, histórico, carteira (só leitura), alertas e sniper.

Todas exigem login no painel (ou o TELEMETRY_TOKEN), como as rotas de gestão. Nada aqui saca
Gemas nem envia Coins: o painel só LÊ a carteira.
"""
from __future__ import annotations

import time
from typing import TYPE_CHECKING, Literal

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

from auth import Auth
from market import MarketError
from market_service import MarketService, today_key

if TYPE_CHECKING:
    from manager import AccountManager
    from store import Store

MAX_RULES = 40
ELEMENTS = {"", "NORMAL", "FIRE", "WATER", "GRASS", "ELECTRIC", "ICE", "FIGHTING", "POISON", "GROUND", "FLYING",
            "PSYCHIC", "BUG", "ROCK", "GHOST", "DRAGON", "DARK", "STEEL", "FAIRY"}


class RuleIn(BaseModel):
    kind: Literal["alert", "snipe"]
    enabled: bool = True
    target: Literal["item", "pokemon"] = "item"
    item_id: int | None = Field(None, ge=1, le=10_000_000)
    name: str = Field("", max_length=80)
    busca: str = Field("", max_length=40)
    elemento: str = Field("", max_length=12)
    so_shiny: bool = False
    so_p5: bool = False
    iv_min: int | None = Field(None, ge=0, le=100)
    nivel_min: int | None = Field(None, ge=1, le=1000)
    moeda: Literal["gold", "orb"] = "gold"
    max_price: int = Field(0, ge=0, le=10**12)
    below_avg_pct: float = Field(0, ge=0, le=95)
    account_id: int | None = Field(None, ge=1)
    qty_max: int = Field(0, ge=0, le=1_000_000)
    budget_daily: int = Field(0, ge=0, le=10**13)
    poll_s: int = Field(10, ge=5, le=600)

    @model_validator(mode="after")
    def _check(self):
        if self.target == "item" and not self.item_id:
            raise ValueError("escolha o item")
        if self.target == "pokemon" and not (self.busca.strip() or self.so_shiny or self.so_p5):
            raise ValueError("para Pokémon, informe o nome ou marque shiny/P5")
        if self.target == "pokemon" and self.below_avg_pct:
            raise ValueError("\"abaixo da média\" só existe para itens")
        if self.elemento.upper() not in ELEMENTS:
            raise ValueError("elemento inválido")
        if self.max_price <= 0 and self.below_avg_pct <= 0:
            raise ValueError("defina o preço máximo ou a porcentagem abaixo da média")
        if self.kind == "snipe":
            if not self.account_id:
                raise ValueError("escolha a conta que vai comprar")
            if self.budget_daily <= 0:
                raise ValueError("defina o orçamento diário (o máximo que a regra pode gastar por dia)")
        return self

    def spec(self) -> dict:
        d = self.model_dump(exclude={"kind", "enabled"})
        d["elemento"] = d["elemento"].upper()
        d["busca"] = d["busca"].strip()
        return d


class FavIn(BaseModel):
    item_id: int = Field(ge=1)
    on: bool = True


class SniperIn(BaseModel):
    enabled: bool


class BuyIn(BaseModel):
    listing_id: int = Field(ge=1)
    qty: int = Field(ge=1, le=1_000_000)
    price: int = Field(ge=1)          # preço unitário que o painel mostrou
    moeda: Literal["gold", "orb"]
    account_id: int = Field(ge=1)


def register_market_routes(app: FastAPI, manager: "AccountManager", store: "Store", auth: Auth) -> MarketService:
    svc: MarketService = manager.market

    def guard(request: Request, tok: str | None):
        return auth.guard(request, tok)

    def fail(e: MarketError) -> JSONResponse:
        return JSONResponse({"error": str(e)}, status_code=409)

    def rule_view(r: dict) -> dict:
        s = r["spec"]
        return {"id": r["id"], "kind": r["kind"], "enabled": r["enabled"], "spec": s, "label": svc.describe(s),
                "spentToday": store.rule_spent(r["id"], today_key()),
                "lastFire": int(r["last_fire"] * 1000) if r["last_fire"] else None}

    # ---------------------------------------------------------------- leitura
    @app.get("/api/market/overview")
    async def overview(request: Request, tok: str | None = Query(None, alias="token"), force: bool = False):
        if (r := guard(request, tok)):
            return r
        try:
            return await svc.overview(force)
        except MarketError as e:
            return fail(e)

    @app.get("/api/market/item")
    async def item(request: Request, itemId: int = Query(ge=1), moeda: Literal["gold", "orb"] = "gold",
                   account: int | None = None, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        try:
            return await svc.item_listings(itemId, moeda, account)
        except MarketError as e:
            return fail(e)

    @app.get("/api/market/vitrine")
    async def vitrine(request: Request, moeda: Literal["gold", "orb"] = "gold",
                      ordem: Literal["recentes", "baratos", "caros"] = "baratos", busca: str = Query("", max_length=40),
                      elemento: str = "", pagina: int = Query(0, ge=0, le=500), soShiny: bool = False,
                      soP5: bool = False, ivMin: int | None = Query(None, ge=0, le=100),
                      nivelMin: int | None = Query(None, ge=1, le=1000), account: int | None = None,
                      tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        if elemento.upper() not in ELEMENTS:
            return JSONResponse({"error": "elemento inválido"}, status_code=422)
        try:
            return await svc.vitrine({"tipo": "pokemon", "moeda": moeda, "ordem": ordem, "busca": busca,
                                      "elemento": elemento.upper(), "pagina": pagina, "so_shiny": soShiny,
                                      "so_p5": soP5, "iv_min": ivMin if ivMin is not None else "",
                                      "nivel_min": nivelMin if nivelMin is not None else ""}, account)
        except MarketError as e:
            return fail(e)

    @app.get("/api/market/tape")
    async def tape(request: Request, mode: Literal["global", "vendas", "compras"] = "global",
                   page: int = Query(0, ge=0, le=500), tipo: Literal["", "item", "pokemon", "deposito", "saque"] = "",
                   moeda: Literal["", "gold", "orb"] = "", itemId: int | None = Query(None, ge=1),
                   busca: str = Query("", max_length=40), elemento: str = "", soShiny: bool = False,
                   soP5: bool = False, ordem: str = Query("", max_length=30), account: int | None = None,
                   tok: str | None = Query(None, alias="token")):
        """Histórico de vendas do servidor inteiro (global) ou da conta (vendas/compras)."""
        if (r := guard(request, tok)):
            return r
        if elemento.upper() not in ELEMENTS:
            return JSONResponse({"error": "elemento inválido"}, status_code=422)
        f: dict = {}
        if tipo:
            f["tipo"] = tipo
        if moeda and tipo not in ("deposito", "saque"):
            f["moeda"] = moeda
        if tipo == "item" and itemId:
            f["itemId"] = itemId
        if tipo == "pokemon":
            if busca.strip():
                f["busca"] = busca.strip()
            if elemento:
                f["elemento"] = elemento.upper()
            if soShiny:
                f["soShiny"] = 1
            if soP5:
                f["soP5"] = 1
            if ordem:
                f["ordem"] = ordem
        try:
            res = await svc.history(mode, page, f, account)
        except MarketError as e:
            return fail(e)
        for row in res["rows"]:
            if isinstance(row, dict) and row.get("itemId"):
                row["itemIcon"] = svc.item_info(int(row["itemId"]))["icon"]
        return res

    @app.get("/api/market/sales")
    async def sales(request: Request, itemId: int = Query(ge=1), moeda: Literal["gold", "orb"] = "gold",
                    account: int | None = None, tok: str | None = Query(None, alias="token")):
        """Preço médio de venda por dia (vendas reais do servidor) e histórico local do menor preço."""
        if (r := guard(request, tok)):
            return r
        try:
            series = await svc.sales_series(itemId, moeda, account_id=account)
        except MarketError as e:
            return fail(e)
        since = int((time.time() - 30 * 86400) * 1000)
        return {"itemId": itemId, "moeda": moeda, "sales": series, "floor": store.price_history(itemId, since)}

    @app.get("/api/market/mine")
    async def mine(request: Request, account: int | None = None, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        try:
            return await svc.mine(account)
        except MarketError as e:
            return fail(e)

    @app.get("/api/market/wallet")
    async def wallet(request: Request, account: int | None = None, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        try:
            return await svc.wallet(account)
        except MarketError as e:
            return fail(e)

    @app.get("/api/market/valuation")
    async def valuation(request: Request, tok: str | None = Query(None, alias="token")):
        """Preço estimado dos itens e dos shiny (em Gemas) e US$ por Gema, para o valor do inventário."""
        if (r := guard(request, tok)):
            return r
        try:
            return await svc.valuation()
        except MarketError as e:
            return fail(e)

    @app.get("/api/market/log")
    async def mlog(request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        return {"log": store.market_log(100)}

    # ---------------------------------------------------------------- favoritos
    @app.get("/api/market/favs")
    async def favs(request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        return {"favs": store.market_favs()}

    @app.post("/api/market/favs")
    async def set_fav(request: Request, body: FavIn, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        store.set_market_fav(body.item_id, body.on)
        return {"favs": store.market_favs()}

    # ---------------------------------------------------------------- regras
    @app.get("/api/market/rules")
    async def rules(request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        return {"rules": [rule_view(x) for x in store.list_rules()],
                "sniperEnabled": store.get_setting("sniper_enabled") == "1"}

    def _check_account(body: RuleIn):
        if body.kind == "snipe" and manager.get(body.account_id or 0) is None:
            return JSONResponse({"error": "conta não encontrada (ou desligada)"}, status_code=422)
        return None

    @app.post("/api/market/rules")
    async def add_rule(request: Request, body: RuleIn, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        if len(store.list_rules()) >= MAX_RULES:
            return JSONResponse({"error": f"limite de {MAX_RULES} regras"}, status_code=409)
        if (bad := _check_account(body)):
            return bad
        rid = store.add_rule(body.kind, body.spec(), body.enabled)
        return rule_view(store.get_rule(rid))

    @app.put("/api/market/rules/{rule_id}")
    async def edit_rule(rule_id: int, request: Request, body: RuleIn, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        cur = store.get_rule(rule_id)
        if cur is None:
            return JSONResponse({"error": "regra não encontrada"}, status_code=404)
        if body.kind != cur["kind"]:
            return JSONResponse({"error": "não dá para trocar o tipo da regra"}, status_code=422)
        if (bad := _check_account(body)):
            return bad
        store.update_rule(rule_id, spec=body.spec(), enabled=body.enabled)
        return rule_view(store.get_rule(rule_id))

    @app.post("/api/market/rules/{rule_id}/toggle")
    async def toggle_rule(rule_id: int, request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        cur = store.get_rule(rule_id)
        if cur is None:
            return JSONResponse({"error": "regra não encontrada"}, status_code=404)
        store.update_rule(rule_id, enabled=not cur["enabled"])
        return rule_view(store.get_rule(rule_id))

    @app.delete("/api/market/rules/{rule_id}")
    async def del_rule(rule_id: int, request: Request, tok: str | None = Query(None, alias="token")):
        if (r := guard(request, tok)):
            return r
        store.delete_rule(rule_id)
        return {"ok": True}

    # ---------------------------------------------------------------- sniper
    @app.put("/api/market/sniper")
    async def set_sniper(request: Request, body: SniperIn, tok: str | None = Query(None, alias="token")):
        """Chave geral das compras automáticas (padrão: desligada)."""
        if (r := guard(request, tok)):
            return r
        store.set_setting("sniper_enabled", "1" if body.enabled else "0")
        store.add_market_log(None, None, "sniper", "sniper LIGADO" if body.enabled else "sniper DESLIGADO")
        return {"sniperEnabled": body.enabled}

    @app.post("/api/market/buy")
    async def buy(request: Request, body: BuyIn, tok: str | None = Query(None, alias="token")):
        """Compra manual de um anúncio, pelo painel (o painel confirma com o usuário antes)."""
        if (r := guard(request, tok)):
            return r
        c = svc.pick(body.account_id)
        if c is None:
            return JSONResponse({"error": "a conta escolhida está offline"}, status_code=409)
        try:
            res = await c.market.comprar(body.listing_id, body.qty, body.price, body.moeda)
        except MarketError as e:
            return fail(e)
        store.add_market_log(body.account_id, None, res["status"],
                             f"compra manual #{body.listing_id} ×{body.qty} a {body.price} ({body.moeda}): {res['status']}")
        return res

    return svc

import asyncio
import json
import time

import pytest
from fastapi.testclient import TestClient

import market_service as ms
from auth import Auth
from manager import AccountManager
from market import MarketClient, MarketError
from notify import DailyStats, Notifier
from telemetry import create_app

KEY = "chave-de-teste"
H = {"Authorization": f"Bearer {KEY}"}


class FakeWS:
    """Websocket de mentira: guarda o que foi enviado e deixa o teste responder."""

    def __init__(self):
        self.sent = []
        self.on_send = None

    async def send(self, raw):
        msg = json.loads(raw)
        self.sent.append(msg)
        if self.on_send:
            self.on_send(msg)


def make_client():
    mc = MarketClient("acc1", {})
    mc.bind(FakeWS())
    return mc


def run(coro):
    return asyncio.run(coro)


# ------------------------------------------------------------------ cliente
def test_item_request_matches_response():
    async def go():
        mc = make_client()

        def reply(msg):
            # uma resposta de outro item chega antes e NÃO pode ser aceita
            asyncio.get_running_loop().call_soon(mc.handle_frame, {"t": "market", "aba": "item", "itemId": 99, "moeda": "gold", "linhas": []})
            asyncio.get_running_loop().call_soon(mc.handle_frame, {"t": "market", "aba": "item", "itemId": 23, "moeda": "gold", "linhas": [{"id": 1}]})

        mc._ws.on_send = reply
        res = await mc.item(23, "gold")
        assert res["linhas"] == [{"id": 1}]
        assert mc._ws.sent[0] == {"t": "market.item", "itemId": 23, "moeda": "gold"}

    run(go())


def test_rejects_bad_currency():
    async def go():
        with pytest.raises(MarketError):
            await make_client().item(1, "usdt")

    run(go())


def test_request_times_out(monkeypatch):
    monkeypatch.setattr("market.REQUEST_TIMEOUT_S", 0.05)

    async def go():
        mc = make_client()
        with pytest.raises(MarketError):
            await mc.request({"t": "market.medias"}, lambda m: False, timeout=0.05)

    run(go())


def test_history_uses_seq():
    async def go():
        mc = make_client()

        def reply(msg):
            asyncio.get_running_loop().call_soon(
                mc.handle_frame, {"t": "market", "aba": "historicoGlobal", "seq": msg["seq"], "linhas": [{"bruto": 5}]})

        mc._ws.on_send = reply
        res = await mc.historico("global", 0, {"tipo": "item", "itemId": 23})
        assert res["linhas"] == [{"bruto": 5}]
        sent = mc._ws.sent[0]
        assert sent["t"] == "market.historicoGlobal" and sent["itemId"] == 23

    run(go())


def test_buy_success_loses_and_refused():
    async def go():
        mc = make_client()
        mc._ws.on_send = lambda m: asyncio.get_running_loop().call_soon(
            mc.handle_frame, {"t": "batalha", "ev": [{"k": "marketComprado", "descricao": "1× Sun Stone", "total": 86000, "moeda": "gold"}]})
        res = await mc.comprar(5, 1, 86000, "gold")
        assert res["status"] == "comprado" and res["total"] == 86000
        assert mc._ws.sent[0] == {"t": "market.comprar", "id": 5, "qtd": 1, "preco": 86000, "moeda": "gold"}

        mc._ws.on_send = lambda m: asyncio.get_running_loop().call_soon(
            mc.handle_frame, {"t": "batalha", "ev": [{"k": "aviso", "msg": "market.sorteio"}, {"k": "aviso", "msg": "market.sorteioPerdeu"}]})
        assert (await mc.comprar(6, 1, 10, "gold"))["status"] == "perdeu_sorteio"

        mc._ws.on_send = lambda m: asyncio.get_running_loop().call_soon(
            mc.handle_frame, {"t": "batalha", "ev": [{"k": "aviso", "msg": "market.semSaldo"}]})
        r = await mc.comprar(7, 1, 10, "gold")
        assert r["status"] == "recusado" and "semSaldo" in r["detail"]

    run(go())


def test_buy_timeout(monkeypatch):
    monkeypatch.setattr("market.BUY_TIMEOUT_S", 0.05)

    async def go():
        assert (await make_client().comprar(1, 1, 10, "gold"))["status"] == "timeout"

    run(go())


def test_clock_offset_from_estado():
    mc = make_client()
    mc.handle_frame({"t": "estado", "estado": {"servidorAgora": int(time.time() * 1000) + 5000}})
    assert 4000 < mc.clock_offset_ms < 6000


def test_unbind_cancels_waiters():
    async def go():
        mc = make_client()
        task = asyncio.create_task(mc.request({"t": "market.medias"}, lambda m: False, timeout=5))
        await asyncio.sleep(0.05)
        mc.unbind()
        with pytest.raises(MarketError):
            await task

    run(go())


# ------------------------------------------------------------------ regras puras
def test_threshold():
    assert ms.threshold({"max_price": 100}, None) == 100
    assert ms.threshold({"below_avg_pct": 20}, 1000) == 800
    assert ms.threshold({"max_price": 700, "below_avg_pct": 20}, 1000) == 700   # vale o menor
    assert ms.threshold({"below_avg_pct": 20}, None) == 0                        # sem média, não dispara


def test_pick_candidates_filters_and_sorts():
    rows = [
        {"id": 1, "preco": 50, "vendedor": "Eu", "estado": "aberto"},
        {"id": 2, "preco": 40, "vendedor": "Outro", "estado": "aberto"},
        {"id": 3, "preco": 30, "vendedor": "Outro", "estado": "vendido"},
        {"id": 4, "preco": 200, "vendedor": "Outro", "estado": "aberto"},
        {"id": 5, "preco": 45, "vendedor": "Outro", "estado": "aberto"},
        {"id": 6, "preco": 10, "vendedor": "Outro", "estado": "aberto", "comprador": "x"},
    ]
    got = ms.pick_candidates(rows, 100, "eu", {5: time.time() + 60})
    assert [a["id"] for a in got] == [2]


def test_plan_qty_respects_balance_budget_cap():
    a = {"id": 1, "preco": 100, "qtd": 50, "tipo": "item"}
    assert ms.plan_qty(a, {}, 10_000, 10_000) == 50
    assert ms.plan_qty(a, {"qty_max": 5}, 10_000, 10_000) == 5
    assert ms.plan_qty(a, {}, 250, 10_000) == 2              # saldo
    assert ms.plan_qty(a, {}, 10_000, 399) == 3              # orçamento
    assert ms.plan_qty({"preco": 100, "qtd": 9, "tipo": "pokemon"}, {}, 10_000, 10_000) == 1
    assert ms.plan_qty(a, {}, 50, 10_000) == 0


# ------------------------------------------------------------------ API + sniper
class FakeConn:
    def __init__(self, idx=1, nick="Ash", gold=10_000):
        self.market = MarketClient(f"acc{idx}", {})
        self.market.bind(FakeWS())
        self.estado = {"gold": gold, "orbs": 0}
        self.acc = type("A", (), {"index": idx, "nick": nick, "name": f"ACC{idx}"})()
        self.mercado_cfg = {"catalogo": [{"id": 23, "nome": "Cocoon Stone", "categoria": "stone"}]}
        self.itens_nossos = {}
        self.inventory = type("Inv", (), {"pokemons": lambda self_: [
            {"id": 7, "nome": "Pikachu", "shiny": True}, {"id": 8, "nome": "Pikachu", "shiny": True},
            {"id": 9, "nome": "Rattata", "shiny": False}]})()


@pytest.fixture
def env(store, tmp_path, monkeypatch):
    monkeypatch.setattr(AccountManager, "_spawn", lambda self, row: None)
    mgr = AccountManager(store, Notifier(""), DailyStats(path=str(tmp_path / "d.json")))
    conn = FakeConn()
    mgr._conns[1] = conn
    app = create_app(mgr.connections, Auth(store, exposed=False, env_token=KEY), manager=mgr, store=store)
    c = TestClient(app)
    c.mgr, c.conn, c.store = mgr, conn, store
    return c


def snipe_body(**kw):
    b = {"kind": "snipe", "target": "item", "item_id": 23, "moeda": "gold", "max_price": 100,
         "account_id": 1, "budget_daily": 1000}
    b.update(kw)
    return b


def test_api_requires_auth(env):
    assert env.get("/api/market/rules").status_code == 401
    assert env.get("/api/market/overview").status_code == 401


def test_rule_validation(env):
    post = lambda b: env.post("/api/market/rules", json=b, headers=H)  # noqa: E731
    assert post(snipe_body()).status_code == 200
    assert post(snipe_body(budget_daily=0)).status_code == 422          # sem orçamento não existe sniper
    assert post(snipe_body(max_price=0)).status_code == 422             # sem teto de preço
    assert post(snipe_body(account_id=None)).status_code == 422
    assert post(snipe_body(account_id=9)).status_code == 422            # conta inexistente
    assert post({"kind": "alert", "target": "item", "max_price": 5}).status_code == 422   # falta o item
    assert post({"kind": "alert", "target": "pokemon", "max_price": 5}).status_code == 422
    assert post({"kind": "alert", "target": "pokemon", "busca": "Pikachu", "max_price": 5}).status_code == 200
    assert post({"kind": "alert", "target": "item", "item_id": 23, "below_avg_pct": 20}).status_code == 200


def test_rule_crud_and_sniper_switch(env):
    r = env.post("/api/market/rules", json=snipe_body(), headers=H).json()
    rid = r["id"]
    assert r["label"] == "Cocoon Stone"
    assert env.post(f"/api/market/rules/{rid}/toggle", headers=H).json()["enabled"] is False
    assert env.get("/api/market/rules", headers=H).json()["sniperEnabled"] is False
    assert env.put("/api/market/sniper", json={"enabled": True}, headers=H).json() == {"sniperEnabled": True}
    assert env.get("/api/market/rules", headers=H).json()["sniperEnabled"] is True
    assert env.delete(f"/api/market/rules/{rid}", headers=H).json() == {"ok": True}
    assert env.get("/api/market/rules", headers=H).json()["rules"] == []


def test_favs(env):
    assert env.post("/api/market/favs", json={"item_id": 23, "on": True}, headers=H).json() == {"favs": [23]}
    assert env.post("/api/market/favs", json={"item_id": 23, "on": False}, headers=H).json() == {"favs": []}


def test_offline_returns_409(env):
    env.conn.market.unbind()
    r = env.get("/api/market/overview", headers=H)
    assert r.status_code == 409 and "online" in r.json()["error"]


def _answer(conn, listings, resumo_min=50):
    """Faz o FakeWS responder aos pedidos de mercado como o jogo faria."""
    def reply(msg):
        loop = asyncio.get_running_loop()
        if msg["t"] == "market.itens":
            loop.call_soon(conn.market.handle_frame, {"t": "market", "aba": "itens", "medias": {},
                           "resumo": {"23": {"anuncios": 1, "unidades": 5, "minGold": resumo_min, "minOrb": None}}})
        elif msg["t"] == "market.item":
            loop.call_soon(conn.market.handle_frame, {"t": "market", "aba": "item", "itemId": msg["itemId"],
                           "moeda": msg["moeda"], "linhas": listings})
        elif msg["t"] == "market.comprar":
            loop.call_soon(conn.market.handle_frame, {"t": "batalha", "ev": [
                {"k": "marketComprado", "descricao": "5× Cocoon Stone", "total": msg["qtd"] * msg["preco"], "moeda": msg["moeda"]}]})
    conn.market.bind(FakeWS())
    conn.market._ws.on_send = reply


def test_sniper_buys_within_limits(env, monkeypatch):
    listing = {"id": 77, "vendedor": "Outro", "qtd": 50, "preco": 80, "estado": "aberto", "comprador": None,
               "compravelEm": 0, "tipo": "item", "moeda": "gold"}
    monkeypatch.setattr("market.MIN_GAP_S", 0)
    rid = env.store.add_rule("snipe", {"target": "item", "item_id": 23, "moeda": "gold", "max_price": 100,
                                       "account_id": 1, "budget_daily": 1000, "qty_max": 0, "poll_s": 5})
    env.store.set_setting("sniper_enabled", "1")

    async def go():
        _answer(env.conn, [listing])
        svc = env.mgr.market
        await svc.tick()
        await asyncio.gather(*list(svc._tasks))

    run(go())
    buy = [m for m in env.conn.market._ws.sent if m["t"] == "market.comprar"]
    assert len(buy) == 1
    assert buy[0] == {"t": "market.comprar", "id": 77, "qtd": 12, "preco": 80, "moeda": "gold"}  # 1000 // 80
    assert env.store.rule_spent(rid, ms.today_key()) == 12 * 80
    assert env.store.market_log(5)[0]["status"] == "comprado"


def test_sniper_off_by_default_and_without_budget(env, monkeypatch):
    listing = {"id": 78, "vendedor": "Outro", "qtd": 5, "preco": 10, "estado": "aberto", "compravelEm": 0, "tipo": "item"}
    monkeypatch.setattr("market.MIN_GAP_S", 0)
    env.store.add_rule("snipe", {"target": "item", "item_id": 23, "moeda": "gold", "max_price": 100,
                                 "account_id": 1, "budget_daily": 1000, "poll_s": 5})

    async def go():
        _answer(env.conn, [listing])
        await env.mgr.market.tick()           # chave geral desligada: nada acontece
        assert not env.mgr.market._tasks

    run(go())
    assert not [m for m in env.conn.market._ws.sent if m["t"] == "market.comprar"]


def test_sniper_never_buys_own_listing_or_above_cap(env, monkeypatch):
    monkeypatch.setattr("market.MIN_GAP_S", 0)
    env.store.add_rule("snipe", {"target": "item", "item_id": 23, "moeda": "gold", "max_price": 100,
                                 "account_id": 1, "budget_daily": 1000, "poll_s": 5})
    env.store.set_setting("sniper_enabled", "1")
    rows = [{"id": 1, "vendedor": "Ash", "qtd": 5, "preco": 10, "estado": "aberto", "compravelEm": 0, "tipo": "item"},
            {"id": 2, "vendedor": "X", "qtd": 5, "preco": 101, "estado": "aberto", "compravelEm": 0, "tipo": "item"}]

    async def go():
        _answer(env.conn, rows, resumo_min=10)
        await env.mgr.market.tick()
        assert not env.mgr.market._tasks

    run(go())
    assert not [m for m in env.conn.market._ws.sent if m["t"] == "market.comprar"]


def test_alert_notifies_once_per_listing(env, monkeypatch):
    monkeypatch.setattr("market.MIN_GAP_S", 0)
    sent = []
    env.mgr.market.notifier = type("N", (), {"send": lambda self, *a, **k: sent.append(a)})()
    env.store.add_rule("alert", {"target": "item", "item_id": 23, "moeda": "gold", "max_price": 100})
    rows = [{"id": 9, "vendedor": "X", "qtd": 3, "preco": 60, "estado": "aberto", "compravelEm": 0, "tipo": "item"}]

    async def go():
        _answer(env.conn, rows, resumo_min=60)
        svc = env.mgr.market
        await svc.tick()
        svc._last_check.clear()
        await svc.tick()

    run(go())
    assert len(sent) == 1 and "Cocoon Stone" in sent[0][0]


def test_price_history_snapshot(env, monkeypatch):
    monkeypatch.setattr("market.MIN_GAP_S", 0)

    async def go():
        _answer(env.conn, [])
        await env.mgr.market.snapshot_if_due()
        await env.mgr.market.snapshot_if_due()   # dentro do intervalo: não repete

    run(go())
    rows = env.store.price_history(23, 0)
    assert len(rows) == 1 and rows[0]["minGold"] == 50


def test_wallet_is_read_only_and_hides_address(env, monkeypatch):
    monkeypatch.setattr("market.MIN_GAP_S", 0)
    painel = {"t": "orbs", "saldo": 120, "precos": {"compra": 0.01, "saque": 0.008, "minimo": 500},
              "deposito": {"meu": "ENDERECO-SECRETO"}, "referencia": "abc",
              "saques": [{"orbs": 500, "usdt": 4, "status": "confirmado"}],
              "extrato": [{"motivo": "market_venda", "delta": 50, "saldo": 120}]}

    def reply(msg):
        assert msg["t"] == "orbs.painel"      # a carteira só faz consulta
        asyncio.get_running_loop().call_soon(env.conn.market.handle_frame, painel)

    async def go():
        env.conn.market._ws.on_send = reply
        return await env.mgr.market.wallet()

    out = run(go())
    assert out["balance"] == 120 and out["withdrawals"][0]["status"] == "confirmado"
    assert "ENDERECO-SECRETO" not in json.dumps(out)


def test_bot_never_sends_withdraw_or_transfer():
    import inspect

    import market
    import market_api
    import market_service
    for mod in (market, market_service, market_api):
        src = inspect.getsource(mod)
        # só pode aparecer em comentário/docstring; nunca como mensagem enviada
        assert '"t": "orbs.sacar"' not in src and '"t": "banco.coins"' not in src


def test_valuation_items_and_shiny(env, monkeypatch):
    monkeypatch.setattr("market.MIN_GAP_S", 0)
    reqs = []

    def reply(msg):
        loop = asyncio.get_running_loop()
        reqs.append(msg["t"])
        h = env.conn.market.handle_frame
        if msg["t"] == "market.itens":
            loop.call_soon(h, {"t": "market", "aba": "itens", "resumo": {"23": {"anuncios": 1, "unidades": 1, "minGold": 5, "minOrb": 2}},
                               "medias": {"23": {"orb": {"media": 40, "unidades": 9}, "gold": {"media": 100, "unidades": 3}}}})
        elif msg["t"] == "market.medias":
            loop.call_soon(h, {"t": "market", "aba": "medias", "dias": 7, "medias": {"23": {"orb": {"media": 40, "unidades": 9}}}})
        elif msg["t"] == "market.historicoGlobal":
            assert msg["tipo"] == "pokemon" and msg["soShiny"] == 1 and msg["moeda"] == "orb" and msg["busca"] == "Pikachu"
            rows = [{"bruto": b, "moeda": "orb"} for b in (100, 300, 200)]
            loop.call_soon(h, {"t": "market", "aba": "historicoGlobal", "seq": msg["seq"], "linhas": rows})
        elif msg["t"] == "orbs.painel":
            loop.call_soon(h, {"t": "orbs", "saldo": 1, "precos": {"saque": 0.01}, "saques": [], "extrato": []})

    async def go():
        env.conn.market._ws.on_send = reply
        v1 = await env.mgr.market.valuation()
        n_hist = reqs.count("market.historicoGlobal")
        await env.mgr.market.valuation()          # a espécie já está em cache: não consulta de novo
        return v1, n_hist, reqs.count("market.historicoGlobal")

    v, first, second = run(go())
    assert v["items"]["23"]["gems"] == 40 and "gold" not in json.dumps(v["items"])
    assert v["usdPerGem"] == 0.01
    assert [s["gems"] for s in v["shinies"]] == [200, 200]          # mediana das vendas; só os shiny contam
    assert first == 1 and second == 1


def test_icon_by_history_description(env):
    env.conn.itens_nossos = {70013: {"name": "Bicycle Fragment", "icon": "items/bike_frag.png"}}
    svc = env.mgr.market
    assert svc.icon_by_name("1× Bicycle Fragment") == "https://pokeidle.io/assets/items/bike_frag.png"
    assert svc.icon_by_name("13× Cocoon Stone") is not None            # nome do catálogo
    assert svc.icon_by_name("Item que não existe") is None


def test_sell_premium_only_when_worth_selling():
    sp = ms.sell_premium
    assert sp(398, 217, 6975, 0.3) == pytest.approx(398 / 217 - 1)   # chave bem acima da média
    assert sp(250, 217, 6975, 0.3) is None                           # só +15%: abaixo do limite
    assert sp(2, 217, 6975, 0.3) is None                             # preço de fachada
    assert sp(400, 217, 1, 0.3) is None                              # quase sem vendas: média não confiável
    assert sp(None, 217, 50, 0.3) is None and sp(400, None, 50, 0.3) is None

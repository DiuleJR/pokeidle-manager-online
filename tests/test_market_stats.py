import asyncio

import market_stats as ms

NOW = 1_795_000_000_000
H = 3_600_000


def sale(i, ago_h, **kw):
    r = {"id": i, "em": NOW - int(ago_h * H), "tipo": "item", "moeda": "gold", "bruto": 100,
         "descricao": "2× Fire Stone", "ficha": None}
    r.update(kw)
    return r


def poke(i, ago_h, name="Garchomp", price=1000, shiny=False, moeda="gold"):
    return sale(i, ago_h, tipo="pokemon", bruto=price, moeda=moeda, descricao=f"{name} Nv 50",
                ficha={"nome": name, "shiny": shiny, "speciesId": 445, "ivTotal": 120, "level": 50, "looktype": 60445})


def test_parse_sale():
    assert ms.parse_sale(sale(1, 0)) == (1, NOW, "item", "gold", 100.0, 2, "Fire Stone", None, 0, None, None, None)
    p = ms.parse_sale(poke(2, 0, shiny=True))
    assert p[2:9] == ("pokemon", "gold", 1000.0, 1, "Garchomp", 445, 1) and p[9:] == (120, 50, 60445)
    assert ms.parse_sale(sale(3, 0, descricao="Sun Stone"))[5:7] == (1, "Sun Stone")
    assert ms.parse_sale(sale(4, 0, tipo="deposito")) is None
    assert ms.parse_sale(sale(5, 0, moeda=None)) is None
    assert ms.parse_sale({"id": 1}) is None


def test_store_dedup_and_last_id(store):
    rows = [ms.parse_sale(sale(i, 1)) for i in (10, 11)]
    assert store.add_sales(rows) == 2
    assert store.add_sales(rows) == 0
    assert store.last_sale_id() == 11


class FakeSvc:
    """Histórico global com páginas de 2 vendas, da mais nova para a mais velha."""

    def __init__(self, ids, repeat_last=False):
        self.ids, self.repeat_last, self.calls = ids, repeat_last, 0

    async def history(self, modo, pagina, filtros):
        self.calls += 1
        chunk = self.ids[pagina * 2: pagina * 2 + 2]
        if not chunk and self.repeat_last:
            chunk = self.ids[-2:]
        return {"rows": [sale(i, 1) for i in chunk], "hasMore": None}


def test_collect_stops_at_known_id(store):
    svc = FakeSvc([9, 8, 7, 6, 5, 4])
    assert asyncio.run(ms.collect(svc, store)) == 6 and svc.calls == 4
    svc2 = FakeSvc([12, 11, 10, 9, 8, 7, 6, 5])
    assert asyncio.run(ms.collect(svc2, store)) == 3          # só 10, 11 e 12 são novos
    assert svc2.calls == 2                                    # parou na página que tem o id já gravado
    assert asyncio.run(ms.collect(FakeSvc([12, 11]), store)) == 0


def test_collect_stops_when_game_repeats_page(store):
    svc = FakeSvc([5, 4, 3, 2], repeat_last=True)
    asyncio.run(ms.collect(svc, store))
    assert svc.calls <= 4 and store.last_sale_id() == 5


def test_overview_ranks_prices_and_movers(store):
    rows = []
    i = 0

    def add(r):
        nonlocal i
        i += 1
        rows.append(ms.parse_sale({**r, "id": i}))

    for _ in range(4):
        add(sale(0, 10, bruto=200, descricao="2× Fire Stone"))        # período atual: 100 por unidade
    for _ in range(4):
        add(sale(0, 30, bruto=100, descricao="2× Fire Stone"))        # período anterior: 50 por unidade
    for _ in range(3):
        add(sale(0, 5, bruto=50, descricao="1× Moon Stone"))
    for _ in range(3):
        add(sale(0, 40, bruto=100, descricao="1× Moon Stone"))        # caiu 50%
    add(sale(0, 5, bruto=999, moeda="orb"))
    add(poke(0, 3, price=5000))
    add(poke(0, 4, price=9000, shiny=True))
    store.add_sales(rows)

    o = ms.overview(store, "gold", "24h", now_ms=NOW)
    assert o["totals"]["sales"] == 4 + 3 + 2 and o["coverage"]["count"] == len(rows)
    fire = next(g for g in o["groups"] if g["name"] == "Fire Stone")
    assert (fire["sales"], fire["units"], fire["typical"]) == (4, 8, 100.0) and fire["kind"] == "item"
    assert o["hourly"] is True and o["source"] == "local" and o["groups"][0]["sales"] == 4      # mais vendas primeiro
    assert {(g["name"], g["shiny"]) for g in o["groups"] if g["kind"] == "pokemon"} == {("Garchomp", False), ("Garchomp", True)}
    assert sum(h["sales"] for h in o["hours"]) == 9
    assert o["hoursFrom"] is not None and o["hoursFrom"] >= NOW - 48 * H
    assert all(g["sales"] for g in o["groups"])

    o7 = ms.overview(store, "gold", "7d", now_ms=NOW)        # 7d: as vendas de 30 h atrás também entram
    fire7 = next(g for g in o7["groups"] if g["name"] == "Fire Stone")
    assert fire7["sales"] == 8 and o7["hourly"] is False

    o1 = ms.overview(store, "gold", "24h", now_ms=NOW)
    # janela anterior de 24h (24-48 h atrás): Fire Stone caiu... subiu de 50 para 100
    fs = next(g for g in o1["groups"] if g["name"] == "Fire Stone")
    assert fs["change"] == 100.0
    assert [g["name"] for g in o1["up"]] == ["Fire Stone"]
    assert [g["name"] for g in o1["down"]] == ["Moon Stone"] and o1["down"][0]["change"] == -50.0


def test_detail_series(store):
    store.add_sales([ms.parse_sale(sale(i, h, bruto=100 * (i + 1))) for i, h in enumerate((1, 2, 30), start=1)])
    d = ms.detail(store, "item", "Fire Stone", False, "gold", "7d", now_ms=NOW)
    assert sum(p["sales"] for p in d["points"]) == 3 and d["hourly"] is False
    assert all(p["avg"] and p["min"] <= p["avg"] <= p["max"] for p in d["points"])
    assert ms.detail(store, "item", "Nada", False, "gold", "7d", now_ms=NOW)["points"] == []

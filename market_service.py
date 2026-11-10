"""Serviço do Mercado: cache de preços, histórico, alertas no Discord e o sniper.

Tudo que consulta o mercado passa por uma conta ONLINE (a escolhida na regra, ou a primeira
disponível) e é somente leitura. A única ação que gasta é a compra do sniper, e ela só roda
quando TODAS as travas abaixo estão satisfeitas:

    - a chave geral `sniper_enabled` está ligada (padrão: desligada);
    - a regra está ligada e tem orçamento diário > 0 (na moeda da regra);
    - a conta da regra está online e tem saldo para pelo menos 1 unidade;
    - o anúncio está aberto, é de outro jogador e custa no máximo o preço da regra.

Perder o sorteio da liberação não custa nada (regra do jogo). Saque de Gemas e envio de Coins
NÃO existem aqui, de propósito.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import re

from game_data import ITEM_NAMES, item_icon_path, item_meta, item_name
from market import MarketError
from notify import BLUE, GOLD, GREEN, RED

if TYPE_CHECKING:
    from manager import AccountManager
    from notify import Notifier
    from store import Store

log = logging.getLogger("market")

TICK_S = 4                       # passo do laço de regras
ITENS_TTL_S = 8                  # idade máxima do resumo de itens usado pelo sniper
MEDIAS_TTL_S = 300               # médias de 7 dias mudam devagar
OVERVIEW_TTL_S = 20              # cache do painel
SNAPSHOT_EVERY_S = 30 * 60       # histórico de preços (menor preço por item)
MIN_POLL_S = 5
DEFAULT_POLL_S = 10
MAX_WAIT_S = 200                 # só agenda compra de anúncio que libera em até isso (a espera é ~2 min)
ALERT_MIN_CHECK_S = 30
SELL_CHECK_S = 120               # confere se algum item meu está caro
SELL_COOLDOWN_S = 6 * 3600       # não repete o aviso do mesmo item antes disso...
SELL_RISE = 0.25                 # ...a menos que o ágio suba mais 25 pontos
SELL_MIN_SOLD = 3                # média de 7 dias só vale com algumas vendas
SALE_CHECK_S = 60                # confere as vendas das contas
SITE = "https://pokeidle.io"
PT_NAMES = {70011: "Fragmento de Chave", 70012: "Fragmento de Shiny Stone", 70013: "Fragmento de Bicicleta"}

# ------------------------------------------------------------------ cálculo puro (testável)


def today_key(now: float | None = None) -> str:
    return datetime.fromtimestamp(now if now is not None else time.time(), tz=timezone.utc).strftime("%Y-%m-%d")


def threshold(spec: dict, avg: float | None) -> int:
    """Preço unitário máximo da regra. `max_price` (>0) e/ou `below_avg_pct`: vale o MENOR dos dois.
    0 = a regra não tem teto utilizável (nunca dispara)."""
    limits: list[int] = []
    if int(spec.get("max_price") or 0) > 0:
        limits.append(int(spec["max_price"]))
    pct = float(spec.get("below_avg_pct") or 0)
    if pct > 0 and avg and avg > 0:
        limits.append(int(avg * (1 - pct / 100)))
    return min(limits) if limits else 0


def pick_candidates(listings: list[dict], thr: int, my_nick: str, dead: dict[int, float],
                    now: float | None = None) -> list[dict]:
    """Anúncios que servem: abertos, de outro jogador, até o teto, ainda não descartados. Mais barato primeiro."""
    now = now if now is not None else time.time()
    my = (my_nick or "").lower()
    out = []
    for a in listings or []:
        try:
            preco = int(a["preco"])
            aid = int(a["id"])
        except (KeyError, TypeError, ValueError):
            continue
        if thr <= 0 or preco > thr or preco < 1:
            continue
        if a.get("estado") not in (None, "aberto") or a.get("comprador"):
            continue
        if str(a.get("vendedor") or "").lower() == my:
            continue
        if dead.get(aid, 0) > now:
            continue
        out.append(a)
    out.sort(key=lambda a: (int(a["preco"]), int(a.get("compravelEm") or 0)))
    return out


def plan_qty(listing: dict, spec: dict, balance: float, remaining_budget: float) -> int:
    """Quantas unidades comprar do anúncio respeitando tudo: oferta, `qty_max`, saldo e orçamento."""
    preco = int(listing["preco"])
    qtd = int(listing.get("qtd") or 1)
    if listing.get("tipo") == "pokemon":
        qtd = 1
    cap = int(spec.get("qty_max") or 0)
    if cap > 0:
        qtd = min(qtd, cap)
    qtd = min(qtd, int(balance // preco), int(remaining_budget // preco))
    return max(0, qtd)


def sell_premium(floor: float | None, avg: float | None, sold: int | None, pct: float) -> float | None:
    """Ágio do menor preço anunciado sobre a média de 7 dias (0.5 = 50% acima), se for bom para vender.
    None quando não vale avisar: sem dados, preço de fachada (<10% da média), poucas vendas ou abaixo de `pct`."""
    if not floor or not avg or avg <= 0 or floor < avg * 0.1 or (sold or 0) < SELL_MIN_SOLD:
        return None
    prem = floor / avg - 1
    return prem if prem >= pct else None


# ------------------------------------------------------------------ serviço


class MarketService:
    def __init__(self, manager: "AccountManager", store: "Store", notifier: "Notifier") -> None:
        self.manager = manager
        self.store = store
        self.notifier = notifier
        self._itens: dict = {}
        self._itens_at = 0.0
        self._medias: dict = {}
        self._medias_dias = 7
        self._medias_at = 0.0
        self._ov_lock = asyncio.Lock()
        self._dead: dict[int, float] = {}            # anúncio -> até quando ignorar
        self._inflight: set[int] = set()             # anúncios com compra agendada
        self._reserved: dict[int, float] = {}        # regra -> orçamento reservado em compras no ar
        self._notified: dict[int, set[int]] = {}     # regra -> anúncios já avisados
        self._last_check: dict[int, float] = {}
        self._buy_locks: dict[int, asyncio.Lock] = {}
        self._tasks: set[asyncio.Task] = set()
        self._warned_budget: set[int] = set()
        self._usd_per_gem: tuple[float, float | None] = (0.0, None)
        self._name_ids: tuple[float, dict[str, int]] = (0.0, {})
        self._shiny_cache: dict[str, tuple[float, float | None]] = {}
        self._sell_alerted: dict[tuple[int, str], tuple[float, float]] = {}   # (item, moeda) -> (quando, ágio)
        self._sell_at = 0.0
        self._sale_at = 0.0

    # ------------------------------------------------------------ contas
    def online(self):
        return [c for c in self.manager.connections() if c.market.online]

    def pick(self, account_id: int | None = None):
        if account_id:
            c = self.manager.get(account_id)
            return c if c is not None and c.market.online else None
        o = self.online()
        return o[0] if o else None

    def _need(self, account_id: int | None = None):
        c = self.pick(account_id)
        if c is None:
            raise MarketError("nenhuma conta online para consultar o mercado" if not account_id
                              else "a conta escolhida está offline")
        return c

    # ------------------------------------------------------------ nomes e ícones
    def item_info(self, item_id: int) -> dict:
        iid = int(item_id)
        for c in self.manager.connections():
            for it in (c.mercado_cfg.get("catalogo") or []):
                if isinstance(it, dict) and it.get("id") == iid:
                    return {"id": iid, "name": PT_NAMES.get(iid) or it.get("nome") or item_name(iid),
                            "category": it.get("categoria") or item_meta(iid)[0], "icon": self._icon(iid, c)}
            nos = c.itens_nossos.get(iid)
            if nos:
                return {"id": iid, "name": PT_NAMES.get(iid) or nos.get("name") or item_name(iid),
                        "category": nos.get("category") or "special", "icon": self._abs(nos.get("icon"))}
        return {"id": iid, "name": PT_NAMES.get(iid) or item_name(iid), "category": item_meta(iid)[0],
                "icon": self._abs(item_icon_path(iid))}

    def _ids_by_name(self) -> dict[str, int]:
        """nome (minúsculo, em inglês ou português) -> id do item, para achar o ícone de uma linha do histórico."""
        ts, cached = self._name_ids
        if cached and time.time() - ts < 600:
            return cached
        m: dict[str, int] = {}
        for iid, nm in ITEM_NAMES.items():
            m[str(nm).lower()] = int(iid)
        for iid, nm in PT_NAMES.items():
            m[nm.lower()] = iid
        for c in self.manager.connections():
            for it in (c.mercado_cfg.get("catalogo") or []):
                if isinstance(it, dict) and it.get("nome") and it.get("id"):
                    m[str(it["nome"]).lower()] = int(it["id"])
            for iid, nos in c.itens_nossos.items():
                if nos.get("name"):
                    m[str(nos["name"]).lower()] = int(iid)
        self._name_ids = (time.time(), m)
        return m

    def icon_by_name(self, desc: str | None) -> str | None:
        """Ícone a partir de uma descrição como "13× Cocoon Stone" ou "Common Bicycle #001050"."""
        n = re.sub(r"^\s*[\d.,]+\s*[×x]\s*", "", desc or "")
        n = re.sub(r"\s*#\d+\s*$", "", n).strip().lower()
        iid = self._ids_by_name().get(n)
        return self.item_info(iid)["icon"] if iid else None

    @staticmethod
    def _abs(path: str | None) -> str | None:
        if not path:
            return None
        return SITE + (path if path.startswith("/") else f"/assets/{path}")

    def _icon(self, iid: int, conn) -> str | None:
        nos = conn.itens_nossos.get(iid)
        return self._abs((nos or {}).get("icon") or item_icon_path(iid))

    # ------------------------------------------------------------ visão geral (cache)
    async def refresh_itens(self, max_age: float = ITENS_TTL_S, account_id: int | None = None) -> dict:
        async with self._ov_lock:
            if time.time() - self._itens_at > max_age or not self._itens:
                res = await self._need(account_id).market.itens()
                self._itens = res.get("resumo") or {}
                if isinstance(res.get("medias"), dict) and res["medias"]:
                    self._medias = res["medias"]
                    self._medias_at = time.time()
                self._itens_at = time.time()
            return self._itens

    async def refresh_medias(self, account_id: int | None = None) -> dict:
        async with self._ov_lock:
            if time.time() - self._medias_at > MEDIAS_TTL_S or not self._medias:
                res = await self._need(account_id).market.medias()
                self._medias = res.get("medias") or {}
                self._medias_dias = res.get("dias") or 7
                self._medias_at = time.time()
            return self._medias

    def avg_for(self, item_id: int, moeda: str) -> float | None:
        m = (self._medias.get(str(item_id)) or {}).get(moeda) or {}
        v = m.get("media")
        return float(v) if isinstance(v, (int, float)) and v > 0 else None

    async def overview(self, force: bool = False) -> dict:
        """Todos os itens do mercado: menores preços, oferta, média de 7 dias, selo barato/caro e favoritos."""
        await self.refresh_itens(0 if force else OVERVIEW_TTL_S)
        try:
            await self.refresh_medias()
        except MarketError:
            pass  # sem médias o resto ainda serve
        favs = set(self.store.market_favs())
        items = []
        for sid, r in self._itens.items():
            try:
                iid = int(sid)
            except (TypeError, ValueError):
                continue
            info = self.item_info(iid)
            row = {**info, "ads": r.get("anuncios", 0), "units": r.get("unidades", 0),
                   "minGold": r.get("minGold"), "minOrb": r.get("minOrb"), "fav": iid in favs}
            for moeda, key in (("gold", "Gold"), ("orb", "Orb")):
                m = (self._medias.get(str(iid)) or {}).get(moeda) or {}
                row[f"avg{key}"] = m.get("media")
                row[f"sold{key}"] = m.get("unidades")
                p, a = row.get(f"min{key}"), m.get("media")
                # preço de fachada (menos de 10% da média, ex.: anúncio de 2 Gemas para vender a si mesmo) não é oferta
                row[f"deal{key}"] = (None if not p or not a or p < a * 0.1 else
                                     "barato" if p <= a * 0.85 else "caro" if p >= a * 1.15 else "justo")
            items.append(row)
        return {"ts": int(time.time() * 1000), "days": self._medias_dias, "items": items,
                "online": [c.acc.index for c in self.online()]}

    # ------------------------------------------------------------ consultas passadas à conta
    async def item_listings(self, item_id: int, moeda: str, account_id: int | None = None) -> dict:
        c = self._need(account_id)
        res = await c.market.item(item_id, moeda)
        return {"itemId": item_id, "moeda": moeda, "item": self.item_info(item_id),
                "now": c.market.server_now_ms(), "listings": res.get("linhas") or [],
                "avg": self.avg_for(item_id, moeda)}

    async def vitrine(self, params: dict, account_id: int | None = None) -> dict:
        c = self._need(account_id)
        res = await c.market.listar(**params)
        return {"now": c.market.server_now_ms(), "total": res.get("total"), "page": res.get("pagina", 0),
                "perPage": res.get("porPagina"), "listings": res.get("linhas") or []}

    async def history(self, modo: str, pagina: int, filtros: dict, account_id: int | None = None) -> dict:
        c = self._need(account_id)
        res = await c.market.historico(modo, pagina, filtros)
        return {"mode": modo, "page": res.get("pagina", pagina), "total": res.get("total"),
                "rows": res.get("linhas") or [], "hasMore": res.get("temMais")}

    async def mine(self, account_id: int | None = None) -> dict:
        c = self._need(account_id)
        res = await c.market.meus()
        return {"account": c.acc.index, "now": c.market.server_now_ms(), "listings": res.get("linhas") or []}

    async def wallet(self, account_id: int | None = None) -> dict:
        """Carteira de Gemas (SOMENTE LEITURA): saldo, preços, saques e extrato. Sem endereço de depósito."""
        c = self._need(account_id)
        o = await c.market.orbs_painel()
        saques = [{k: s.get(k) for k in ("orbs", "usdt", "status", "recusado", "motivoRecusa", "tentadoEm", "criadoEm")}
                  for s in (o.get("saques") or []) if isinstance(s, dict)]
        extrato = [{k: e.get(k) for k in ("motivo", "delta", "saldo", "em", "ts")}
                   for e in (o.get("extrato") or [])[:80] if isinstance(e, dict)]
        precos = o.get("precos") or {}
        return {"account": c.acc.index, "nick": c.acc.nick, "balance": o.get("saldo"),
                "prices": {k: precos.get(k) for k in ("compra", "saque", "minimo")},
                "withdrawals": saques, "ledger": extrato, "withdrawLocked": o.get("saqueTravado")}

    async def sales_series(self, item_id: int, moeda: str, pages: int = 4, account_id: int | None = None) -> list[dict]:
        """Preço médio de venda por dia de um item (vendas do servidor inteiro), para o gráfico."""
        c = self._need(account_id)
        days: dict[str, list[tuple[float, int]]] = {}
        for p in range(max(1, min(pages, 8))):
            res = await c.market.historico("global", p, {"tipo": "item", "itemId": int(item_id), "moeda": moeda})
            rows = res.get("linhas") or []
            for r in rows:
                try:
                    ms, bruto, q = int(r["em"]), float(r["bruto"]), int(r.get("qtd") or 1)
                except (KeyError, TypeError, ValueError):
                    continue
                day = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                days.setdefault(day, []).append((bruto / max(q, 1), q))
            if not rows:
                break
        out = []
        for day in sorted(days):
            vals = days[day]
            units = sum(q for _, q in vals)
            out.append({"day": day, "avg": round(sum(p * q for p, q in vals) / max(units, 1), 2),
                        "units": units, "sales": len(vals)})
        return out

    # ------------------------------------------------------------ valor do inventário
    SHINY_TTL_S = 3600
    SHINY_PER_CALL = 6

    async def usd_per_gem(self) -> float | None:
        """US$ por Gema no saque (do painel de Gemas do jogo), em cache por 30 min."""
        ts, val = self._usd_per_gem
        if time.time() - ts < 1800 and val:
            return val
        try:
            w = await self.wallet()
            val = float((w.get("prices") or {}).get("saque") or 0) or None
        except MarketError:
            val = val or None
        self._usd_per_gem = (time.time(), val)
        return val

    async def _shiny_price(self, name: str) -> float | None:
        """Mediana das vendas recentes (em Gemas) de um Pokémon shiny dessa espécie."""
        hit = self._shiny_cache.get(name)
        if hit and time.time() - hit[0] < self.SHINY_TTL_S:
            return hit[1]
        val = None
        try:
            res = await self._need().market.historico(
                "global", 0, {"tipo": "pokemon", "moeda": "orb", "busca": name, "soShiny": 1})
            prices = sorted(float(r["bruto"]) for r in (res.get("linhas") or [])
                            if isinstance(r, dict) and isinstance(r.get("bruto"), (int, float)) and r.get("moeda") in (None, "orb"))
            if prices:
                val = prices[len(prices) // 2]
        except MarketError:
            return None   # sem conta online agora: não grava no cache
        self._shiny_cache[name] = (time.time(), val)
        return val

    async def valuation(self) -> dict:
        """Preço estimado (em Gemas) dos itens e dos Pokémon shiny das contas, e quanto vale 1 Gema em US$.
        Item = média de venda dos últimos 7 dias em Gemas. Shiny = mediana das últimas vendas da espécie."""
        await self.refresh_itens(120)
        await self.refresh_medias()
        items = {}
        for sid, m in self._medias.items():
            o = (m or {}).get("orb") or {}
            avg = o.get("media")
            if isinstance(avg, (int, float)) and avg > 0:
                items[sid] = {"gems": float(avg), "sold": o.get("unidades")}
        shinies = []
        names: list[str] = []
        for c in self.manager.connections():
            for p in c.inventory.pokemons():
                if p.get("shiny"):
                    shinies.append({"account": c.acc.index, "id": p.get("id"), "name": p.get("nome") or "?"})
                    if p.get("nome") and p["nome"] not in names:
                        names.append(p["nome"])
        todo = [n for n in names if not (n in self._shiny_cache and time.time() - self._shiny_cache[n][0] < self.SHINY_TTL_S)]
        for n in todo[: self.SHINY_PER_CALL]:
            await self._shiny_price(n)
        pending = max(0, len(todo) - self.SHINY_PER_CALL)
        for s in shinies:
            s["gems"] = (self._shiny_cache.get(s["name"]) or (0, None))[1]
        return {"usdPerGem": await self.usd_per_gem(), "days": self._medias_dias, "items": items,
                "shinies": shinies, "pending": pending}

    # ------------------------------------------------------------ histórico de preços (local)
    async def snapshot_if_due(self) -> None:
        if time.time() * 1000 - self.store.last_price_snapshot_ts() < SNAPSHOT_EVERY_S * 1000:
            return
        if self.pick() is None:
            return
        itens = await self.refresh_itens(0)
        rows = []
        for sid, r in itens.items():
            try:
                rows.append((int(sid), r.get("minGold"), r.get("minOrb"), int(r.get("anuncios") or 0),
                             int(r.get("unidades") or 0)))
            except (TypeError, ValueError):
                continue
        if rows:
            self.store.add_price_snapshot(int(time.time() * 1000), rows)

    # ------------------------------------------------------------ regras
    def describe(self, spec: dict) -> str:
        if spec.get("target") == "pokemon":
            partes = [spec.get("busca") or "Pokémon"]
            if spec.get("so_shiny"):
                partes.append("shiny")
            if spec.get("so_p5"):
                partes.append("P5")
            return " ".join(partes)
        return spec.get("name") or self.item_info(int(spec.get("item_id") or 0))["name"]

    async def _listings_for(self, spec: dict, conn) -> list[dict]:
        moeda = spec.get("moeda", "gold")
        if spec.get("target") == "pokemon":
            res = await conn.market.listar(
                tipo="pokemon", moeda=moeda, ordem="baratos", busca=spec.get("busca") or "",
                elemento=spec.get("elemento") or "", so_shiny=bool(spec.get("so_shiny")),
                so_p5=bool(spec.get("so_p5")), iv_min=spec.get("iv_min") or "",
                nivel_min=spec.get("nivel_min") or "")
            return res.get("linhas") or []
        item_id = int(spec["item_id"])
        resumo = await self.refresh_itens(max(MIN_POLL_S - 1, ITENS_TTL_S / 2), conn.acc.index)
        r = resumo.get(str(item_id)) or {}
        floor = r.get("minOrb" if moeda == "orb" else "minGold")
        if not floor:
            return []
        thr = threshold(spec, self.avg_for(item_id, moeda))
        if thr <= 0 or floor > thr:
            return []     # barato: o resumo já diz que nada cabe no teto, sem pedir os anúncios
        res = await conn.market.item(item_id, moeda)
        return res.get("linhas") or []

    async def _eval_rule(self, rule: dict, sniper_on: bool) -> None:
        spec, rid = rule["spec"], rule["id"]
        kind = rule["kind"]
        poll = max(MIN_POLL_S, int(spec.get("poll_s") or DEFAULT_POLL_S)) if kind == "snipe" else ALERT_MIN_CHECK_S
        now = time.time()
        if now - self._last_check.get(rid, 0) < poll:
            return
        self._last_check[rid] = now
        if kind == "snipe" and not sniper_on:
            return
        conn = self.pick(int(spec["account_id"])) if kind == "snipe" and spec.get("account_id") else self.pick()
        if conn is None:
            return
        moeda = spec.get("moeda", "gold")
        if spec.get("target") != "pokemon" and spec.get("below_avg_pct"):
            await self.refresh_medias()
        avg = self.avg_for(int(spec.get("item_id") or 0), moeda) if spec.get("target") != "pokemon" else None
        thr = threshold(spec, avg)
        if thr <= 0:
            return
        lines = await self._listings_for(spec, conn)
        cands = pick_candidates(lines, thr, conn.acc.nick, self._dead)
        if not cands:
            return
        if kind == "alert":
            self._alert(rule, conn, cands, thr)
        else:
            for a in cands[:3]:
                self._maybe_snipe(rule, conn, a)

    # ------------------------------------------------------------ alertas
    def _alert(self, rule: dict, conn, cands: list[dict], thr: int) -> None:
        seen = self._notified.setdefault(rule["id"], set())
        new = [a for a in cands if int(a["id"]) not in seen]
        if not new:
            return
        for a in new:
            seen.add(int(a["id"]))
        if len(seen) > 500:
            seen.clear()
        spec = rule["spec"]
        moeda = "Gemas" if spec.get("moeda") == "orb" else "Gold"
        linhas = [f"**{int(a.get('qtd') or 1)}×** a **{int(a['preco']):,}** {moeda} — {a.get('vendedor', '?')}".replace(",", ".")
                  for a in new[:5]]
        self.store.touch_rule(rule["id"])
        self.notifier.send(f"🛒 Alerta de mercado: {self.describe(spec)}", "\n".join(linhas), BLUE,
                           [("Teto da regra", f"{thr:,} {moeda}".replace(",", "."), True)])

    # ------------------------------------------------------------ sniper
    def _maybe_snipe(self, rule: dict, conn, listing: dict) -> None:
        aid = int(listing["id"])
        if aid in self._inflight:
            return
        spec, rid = rule["spec"], rule["id"]
        budget = float(spec.get("budget_daily") or 0)
        if budget <= 0:
            if rid not in self._warned_budget:
                self._warned_budget.add(rid)
                self.store.add_market_log(conn.acc.index, rid, "ignorado", "regra sem orçamento diário: nada será comprado")
            return
        moeda = spec.get("moeda", "gold")
        balance = float(conn.estado.get("orbs" if moeda == "orb" else "gold") or 0)
        spent = self.store.rule_spent(rid, today_key()) + self._reserved.get(rid, 0.0)
        qty = plan_qty(listing, spec, balance, budget - spent)
        if qty < 1:
            return
        cost = int(listing["preco"]) * qty
        self._inflight.add(aid)
        self._reserved[rid] = self._reserved.get(rid, 0.0) + cost
        t = asyncio.create_task(self._buy(rule, conn, listing, qty, cost), name=f"snipe{aid}")
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    async def _buy(self, rule: dict, conn, listing: dict, qty: int, cost: int) -> None:
        aid, rid = int(listing["id"]), rule["id"]
        spec = rule["spec"]
        moeda = spec.get("moeda", "gold")
        label = self.describe(spec)
        status, detail, paid = "erro", "", 0
        try:
            wait = (int(listing.get("compravelEm") or 0) - conn.market.server_now_ms()) / 1000
            if wait > MAX_WAIT_S:
                self._dead[aid] = time.time() + 30
                return
            if wait > 0:
                await asyncio.sleep(wait + 0.05)
            # a decisão pode ter mudado durante a espera
            fresh = self.store.get_rule(rid)
            if (not fresh or not fresh["enabled"] or self.store.get_setting("sniper_enabled") != "1"
                    or not conn.market.online):
                return
            lock = self._buy_locks.setdefault(conn.acc.index, asyncio.Lock())
            async with lock:
                res = await conn.market.comprar(aid, qty, int(listing["preco"]), moeda)
            status, detail = res["status"], res.get("detail") or ""
            if status == "comprado":
                paid = int(res.get("total") or cost)
        except MarketError as e:
            status, detail = "erro", str(e)
        except Exception as e:  # noqa: BLE001 - uma compra com erro não pode derrubar o laço
            log.exception("[snipe] falha inesperada")
            status, detail = "erro", type(e).__name__
        finally:
            self._inflight.discard(aid)
            self._reserved[rid] = max(0.0, self._reserved.get(rid, 0.0) - cost)
        if status == "comprado":
            self.store.add_rule_spent(rid, today_key(), paid)
            self.store.touch_rule(rid)
        self._dead[aid] = time.time() + (3600 if status == "comprado" else 120 if status != "timeout" else 20)
        moeda_nome = "Gemas" if moeda == "orb" else "Gold"
        text = f"{qty}× {label} a {int(listing['preco'])} {moeda_nome} (#{aid}): {status}" + (f" — {detail}" if detail else "")
        self.store.add_market_log(conn.acc.index, rid, status, text)
        log.info("[%s] sniper %s", conn.acc.name, text)
        if status == "comprado":
            self.notifier.send(f"✅ Sniper comprou: {label}", detail or "", GREEN,
                               [("Conta", conn.acc.nick, True), ("Gasto", f"{paid} {moeda_nome}", True)])
        elif status == "perdeu_sorteio":
            self.notifier.send(f"🎲 Sniper perdeu o sorteio: {label}", "Nada foi cobrado.", GOLD,
                               [("Conta", conn.acc.nick, True)])
        elif status in ("recusado", "erro"):
            self.notifier.send(f"⚠️ Sniper não comprou: {label}", detail or status, RED,
                               [("Conta", conn.acc.nick, True)])

    # ------------------------------------------------------------ avisos de venda (Discord)
    def _owned_items(self) -> dict[int, list[tuple[str, int]]]:
        """item raro -> [(nick, quantidade)] nas contas (só raros têm aviso de venda)."""
        from telemetry import item_rows  # import tardio: evita ciclo

        out: dict[int, list[tuple[str, int]]] = {}
        for c in self.manager.connections():
            for row in item_rows(c):
                if row["rare"] and row["qty"] > 0:
                    out.setdefault(row["id"], []).append((c.acc.nick, row["qty"]))
        return out

    async def sell_alerts(self) -> None:
        """Avisa no Discord quando um item que tenho está bem acima da média de 7 dias (hora de vender)."""
        if not self.notifier.enabled or self.store.get_setting("alert_sell") != "1":
            return
        now = time.time()
        if now - self._sell_at < SELL_CHECK_S or self.pick() is None:
            return
        self._sell_at = now
        owned = self._owned_items()
        if not owned:
            return
        pct = max(5, int(self.store.get_setting("alert_sell_pct") or 30)) / 100
        itens = await self.refresh_itens(SELL_CHECK_S / 2)
        await self.refresh_medias()
        for iid, holders in owned.items():
            r = itens.get(str(iid))
            if not r:
                continue
            info = self.item_info(iid)
            total = sum(q for _, q in holders)
            for moeda, key, nome in (("orb", "minOrb", "Gemas"),):   # só Gemas
                m = (self._medias.get(str(iid)) or {}).get(moeda) or {}
                floor, avg = r.get(key), m.get("media")
                prem = sell_premium(floor, avg, m.get("unidades"), pct)
                if prem is None:
                    continue
                prev = self._sell_alerted.get((iid, moeda))
                if prev and now - prev[0] < SELL_COOLDOWN_S and prem < prev[1] + SELL_RISE:
                    continue
                self._sell_alerted[(iid, moeda)] = (now, prem)
                quem = " · ".join(f"{n}: {q}" for n, q in sorted(holders, key=lambda h: -h[1])[:4])
                self.notifier.send(
                    f"💰 Ótimo para vender: {info['name']}",
                    f"Menor preço **{int(floor):,}** {nome} — **+{prem * 100:.0f}%** sobre a média de 7 dias "
                    f"({int(avg):,}).".replace(",", "."),
                    GREEN,
                    [("Você tem", f"{total:,} un.".replace(",", "."), True),
                     ("Valor no menor preço", f"{int(floor * total):,} {nome}".replace(",", "."), True),
                     ("Contas", quem, False)],
                    thumbnail=info.get("icon"))
                log.info("[mercado] ótimo para vender %s (%s): +%.0f%%", info["name"], moeda, prem * 100)

    async def sale_alerts(self) -> None:
        """Avisa no Discord quando um anúncio de uma das contas é vendido (lê o extrato de vendas da conta)."""
        if not self.notifier.enabled or self.store.get_setting("alert_sold") != "1":
            return
        now = time.time()
        if now - self._sale_at < SALE_CHECK_S:
            return
        self._sale_at = now
        for c in self.online():
            key = f"sale_seen_{c.acc.index}"
            seen = int(self.store.get_setting(key) or 0)
            try:
                res = await c.market.historico("vendas", 0, {})
            except MarketError:
                continue
            rows = []
            for r in res.get("linhas") or []:
                try:
                    if isinstance(r, dict) and r.get("tipo") in (None, "item", "pokemon"):
                        rows.append((int(r["em"]), r))
                except (KeyError, TypeError, ValueError):
                    continue
            rows.sort(key=lambda x: x[0])
            if not seen:   # primeira leitura desta conta: marca o ponto de partida sem avisar o passado
                self.store.set_setting(key, str(rows[-1][0] if rows else int(now * 1000)))
                continue
            new = [r for em, r in rows if em > seen]
            if not new:
                continue
            self.store.set_setting(key, str(max(em for em, _ in rows)))
            for r in new[:5]:
                moeda = "Gemas" if r.get("moeda") == "orb" else "Gold"
                bruto = r.get("bruto")
                campos = [("Conta", c.acc.nick, True)]
                if r.get("comprador"):
                    campos.append(("Comprador", str(r["comprador"]), True))
                if isinstance(r.get("liquido"), (int, float)):
                    campos.append(("Você recebeu", f"{int(r['liquido']):,} {moeda}".replace(",", "."), True))
                preco = f"{int(bruto):,} {moeda}".replace(",", ".") if isinstance(bruto, (int, float)) else "?"
                icon = None
                if r.get("tipo") != "pokemon":
                    icon = (self.item_info(int(r["itemId"]))["icon"] if r.get("itemId")
                            else self.icon_by_name(r.get("descricao")))
                self.notifier.send(f"💸 Vendido: {r.get('descricao') or 'anúncio'}", f"Por **{preco}**.", GOLD,
                                   campos, thumbnail=icon)
                self.store.add_market_log(c.acc.index, None, "vendido", f"vendido: {r.get('descricao')} por {preco}")
            if len(new) > 5:
                self.notifier.send(f"💸 Mais {len(new) - 5} vendas em {c.acc.nick}", "Veja em Mercado → Vendas.", GOLD)

    # ------------------------------------------------------------ laço
    async def tick(self) -> None:
        await self.snapshot_if_due()
        for job in (self.sell_alerts, self.sale_alerts):
            try:
                await job()
            except MarketError as e:
                log.debug("aviso de mercado: %s", e)
            except Exception:  # noqa: BLE001
                log.exception("aviso de mercado falhou")
        rules = [r for r in self.store.list_rules() if r["enabled"]]
        if not rules:
            return
        sniper_on = self.store.get_setting("sniper_enabled") == "1"
        for rule in rules:
            try:
                await self._eval_rule(rule, sniper_on)
            except MarketError as e:
                log.debug("regra %s: %s", rule["id"], e)
            except Exception:  # noqa: BLE001
                log.exception("regra %s falhou", rule["id"])
        # limpeza
        now = time.time()
        for k in [k for k, v in self._dead.items() if v < now]:
            self._dead.pop(k, None)

    async def run(self) -> None:
        while True:
            try:
                await self.tick()
            except Exception:  # noqa: BLE001
                log.exception("laço do mercado")
            await asyncio.sleep(TICK_S)

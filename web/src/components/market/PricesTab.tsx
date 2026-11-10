import { AnimatePresence } from "framer-motion";
import { Reveal } from "@/components/ui";
import { Bell, Crosshair, ShoppingCart, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "@/components/SettingsView";
import { ItemSprite } from "@/components/Sprites";
import { useAccountsMap } from "@/lib/telemetry";
import { type Deal, type Listing, type MarketItem, type Moeda, dealLabel, marketApi, secondsUntil } from "@/lib/market";
import { fmtInt, fmtShort } from "@/lib/utils";
import { BuyDialog } from "./BuyDialog";
import { RuleDialog } from "./RulesTab";
import { CurrencyToggle, ErrorBox, LineChart, Loading, Money, type MoedaSel, fmtCountdown, useAsync, useTick } from "./shared";

const SORTS = [
  { id: "discount", label: "Maior desconto" },
  { id: "premium", label: "Mais caros (vender)" },
  { id: "cheap", label: "Menor preço" },
  { id: "supply", label: "Mais ofertas" },
  { id: "name", label: "Nome" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

const DEAL_CLS: Record<string, string> = {
  barato: "border-[#2f6b3a] bg-[#16301c] text-poke-green",
  caro: "border-[#7a5a1c] bg-[#38290f] text-poke-gold",
  justo: "border-line bg-tile text-mute",
};
export function DealBadge({ d }: { d?: Deal }) {
  if (d !== "barato" && d !== "caro") return null; // só destaca o que vale a pena; o resto é ruído
  return (
    <span
      className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-bold uppercase ${DEAL_CLS[d]}`}
      title={d === "caro" ? "15% ou mais acima da média de 7 dias: bom momento para vender" : "15% ou mais abaixo da média de 7 dias: bom momento para comprar"}
    >
      {d === "caro" ? "↑ " : "↓ "}
      {dealLabel(d)}
    </span>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  stone: "Pedras", ball: "Balls", heal: "Poções", revive: "Revive", tm: "TMs", special: "Especiais", loot: "Loot", fragment: "Fragmentos", key: "Chaves",
};

/** Detalhe de um item: anúncios, gráfico de preço e atalhos (alerta, sniper, compra). */
function ItemDetail({ item, moeda: initial, account, onClose, onFav }: { item: MarketItem; moeda: Moeda; account: number | undefined; onClose: () => void; onFav: () => void }) {
  const [moeda, setMoeda] = useState<Moeda>(initial);
  const [buy, setBuy] = useState<Listing | null>(null);
  const [rule, setRule] = useState<"alert" | "snipe" | null>(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const ls = useAsync(async () => {
    const r = await marketApi.item(item.id, moeda, account);
    setFetchedAt(Date.now());
    return r;
  }, [item.id, moeda, account], { every: 10000 });
  const sales = useAsync(() => marketApi.sales(item.id, moeda, account), [item.id, moeda, account]);
  useTick();
  const drift = ls.data ? ls.data.now - fetchedAt : 0;
  const rows = ls.data?.listings ?? [];
  const best = rows[0]?.preco;

  return (
    <Modal title={item.name} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-3">
        <ItemSprite icon={item.icon} size={44} alt="" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-mute">
            {item.ads} anúncios · {fmtShort(item.units)} un.
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            Média 7 dias: <Money v={moeda === "orb" ? item.avgOrb : item.avgGold} moeda={moeda} short />
            {moeda === "orb" && item.soldOrb ? <span className="text-xs text-mute">({fmtShort(item.soldOrb)} vendidos)</span> : null}
            {moeda === "gold" && item.soldGold ? <span className="text-xs text-mute">({fmtShort(item.soldGold)} vendidos)</span> : null}
          </p>
        </div>
        <button className="btn" onClick={onFav} aria-pressed={item.fav} title={item.fav ? "Tirar dos favoritos" : "Favoritar"}>
          <Star className={`size-4 ${item.fav ? "fill-poke-gold text-poke-gold" : ""}`} />
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CurrencyToggle value={moeda} onChange={(m) => setMoeda(m as Moeda)} />
        <div className="grid grid-cols-2 gap-1.5 sm:flex">
          <button className="btn" onClick={() => setRule("alert")}>
            <Bell className="size-4" /> Avisar
          </button>
          <button className="btn" onClick={() => setRule("snipe")}>
            <Crosshair className="size-4" /> Comprar sozinho
          </button>
        </div>
      </div>

      <div className="tile p-3">
        <p className="label mb-2">Preço médio de venda por dia (vendas reais)</p>
        {sales.loading ? (
          <p className="text-sm text-mute">Carregando…</p>
        ) : sales.error ? (
          <p className="text-sm text-mute">{sales.error}</p>
        ) : (
          (() => {
            const sold = (sales.data?.sales ?? []).map((x) => ({ x: x.day, y: x.avg }));
            const lowest = new Map<string, number>();
            for (const f of sales.data?.floor ?? []) {
              const v = moeda === "orb" ? f.minOrb : f.minGold;
              if (v == null) continue;
              const day = new Date(f.ts).toISOString().slice(0, 10);
              lowest.set(day, Math.min(lowest.get(day) ?? Infinity, v));
            }
            const floor = [...lowest].sort().map(([x, y]) => ({ x, y }));
            const days = new Set([...sold, ...floor].map((p) => p.x));
            if (days.size < 2) {
              return (
                <p className="text-sm text-mute">
                  O gráfico aparece quando houver pelo menos 2 dias de dados.
                  {sold[0] ? ` Média de venda hoje: ${fmtInt(sold[0].y)}.` : ""}
                </p>
              );
            }
            return (
              <LineChart
                series={[
                  { name: "Venda média", color: "#f3c04a", points: sold },
                  { name: "Menor preço anunciado", color: "#5cc8e8", points: floor },
                ].filter((x) => x.points.length > 0)}
              />
            );
          })()
        )}
      </div>

      {ls.loading && !ls.data ? (
        <Loading />
      ) : ls.error && !ls.data ? (
        <ErrorBox error={ls.error} onRetry={ls.reload} />
      ) : rows.length === 0 ? (
        <p className="tile p-4 text-center text-sm text-mute">Nenhum anúncio em {moeda === "orb" ? "Gemas" : "Gold"} agora.</p>
      ) : (
        <ul className="max-h-[40vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {rows.slice(0, 60).map((l) => {
            const wait = secondsUntil(l.compravelEm, drift);
            return (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2">
                    <Money v={l.preco} moeda={l.moeda} className="text-[15px] font-bold" />
                    {best && l.preco > best ? <span className="text-xs text-mute">+{Math.round(((l.preco - best) / best) * 100)}%</span> : null}
                  </p>
                  <p className="mt-0.5 flex items-center gap-x-2 text-xs text-mute">
                    <span className="tnum shrink-0">{fmtInt(l.qtd)}×</span>
                    <span className="truncate">{l.vendedor}</span>
                    {wait > 0 ? <span className="tnum shrink-0 text-poke-gold">libera em {fmtCountdown(wait)}</span> : null}
                  </p>
                </div>
                <button
                  className="btn shrink-0 !px-3"
                  onClick={() => setBuy(l)}
                  disabled={wait > 0}
                  title={wait > 0 ? "Ainda não liberado para compra" : undefined}
                  aria-label={wait > 0 ? `Comprar de ${l.vendedor} (libera em ${fmtCountdown(wait)})` : `Comprar de ${l.vendedor}`}
                >
                  <ShoppingCart className="size-4" />
                  <span className="hidden sm:inline">Comprar</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <AnimatePresence>
        {buy && <BuyDialog listing={buy} name={item.name} onClose={() => setBuy(null)} onDone={() => void ls.reload()} />}
        {rule && <RuleDialog kind={rule} preset={{ target: "item", item_id: item.id, name: item.name, moeda }} onClose={() => setRule(null)} onSaved={() => setRule(null)} />}
      </AnimatePresence>
    </Modal>
  );
}

export function PricesTab() {
  const [moeda, setMoeda] = useState<MoedaSel>("gold");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [onlyFav, setOnlyFav] = useState(false);
  const [sort, setSort] = useState<SortId>("discount");
  const [open, setOpen] = useState<MarketItem | null>(null);
  const ov = useAsync(() => marketApi.overview(), [], { every: 30000 });
  const [favs, setFavs] = useState<Record<number, boolean>>({});
  const accounts = useAccountsMap();
  const owned = useMemo(() => {
    const m: Record<number, number> = {};
    for (const a of Object.values(accounts)) for (const it of a.inventory?.items ?? []) m[it.id] = (m[it.id] ?? 0) + it.qty;
    return m;
  }, [accounts]);

  const items = useMemo(() => (ov.data?.items ?? []).map((i) => (i.id in favs ? { ...i, fav: favs[i.id] } : i)), [ov.data, favs]);
  const cats = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(), [items]);

  const price = (i: MarketItem) => (moeda === "orb" ? i.minOrb : moeda === "gold" ? i.minGold : (i.minGold ?? i.minOrb));
  const avg = (i: MarketItem) => (moeda === "orb" ? i.avgOrb : i.avgGold);
  const deal = (i: MarketItem): Deal | undefined => (moeda === "orb" ? i.dealOrb : moeda === "gold" ? i.dealGold : i.dealGold === "barato" || i.dealOrb === "barato" ? "barato" : (i.dealGold ?? i.dealOrb));
  const disc = (p: number | null | undefined, a: number | null | undefined) => (p && a && p >= a * 0.1 ? (a - p) / a : -1); // < 10% da média = preço de fachada
  const discount = (i: MarketItem) =>
    moeda === "all" ? Math.max(disc(i.minGold, i.avgGold), disc(i.minOrb, i.avgOrb)) : disc(price(i), avg(i));
  /** Quanto o menor preço está acima da média (0.5 = +50%); -1 = sem dado ou preço de fachada. */
  const premium = (i: MarketItem) => {
    const one = (p: number | null | undefined, a: number | null | undefined) => (p && a && p >= a * 0.1 ? (p - a) / a : -1);
    return moeda === "all" ? Math.max(one(i.minGold, i.avgGold), one(i.minOrb, i.avgOrb)) : one(price(i), avg(i));
  };

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const out = items.filter((i) => price(i) != null && (!t || i.name.toLowerCase().includes(t)) && (!cat || i.category === cat) && (!onlyFav || i.fav));
    out.sort((a, b) =>
      sort === "discount" ? discount(b) - discount(a) : sort === "premium" ? premium(b) - premium(a) : sort === "cheap" ? (price(a) ?? 0) - (price(b) ?? 0) : sort === "supply" ? b.units - a.units : a.name.localeCompare(b.name),
    );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, q, cat, onlyFav, sort, moeda]);

  const toggleFav = async (i: MarketItem) => {
    setFavs((f) => ({ ...f, [i.id]: !i.fav }));
    try {
      await marketApi.setFav(i.id, !i.fav);
    } catch {
      setFavs((f) => ({ ...f, [i.id]: i.fav }));
    }
  };

  if (ov.loading && !ov.data) return <Loading text="Consultando o mercado…" />;
  if (ov.error && !ov.data) return <ErrorBox error={ov.error} onRetry={ov.reload} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-2 sm:w-72">
          <input className="field min-w-0 flex-1" type="search" placeholder="Buscar item…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar item" />
          <button className="btn shrink-0 !px-3" data-active={onlyFav} aria-pressed={onlyFav} onClick={() => setOnlyFav(!onlyFav)} title="Só favoritos" aria-label="Só favoritos">
            <Star className={`size-4 ${onlyFav ? "fill-poke-gold" : ""}`} />
          </button>
        </div>
        <CurrencyToggle value={moeda} onChange={setMoeda} allowAll />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <select className="field min-w-0" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
            <option value="">Categorias</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c] ?? c}
              </option>
            ))}
          </select>
          <select className="field min-w-0" value={sort} onChange={(e) => setSort(e.target.value as SortId)} aria-label="Ordenar">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-mute">
        {rows.length} itens · <span className="text-poke-green">Barato</span> = 15% ou mais abaixo da média de {ov.data?.days ?? 7} dias ·{" "}
        <span className="text-poke-gold">Caro</span> = 15% ou mais acima (bom para vender)
      </p>

      {rows.length === 0 ? (
        <p className="card p-8 text-center text-sm text-mute">Nenhum item com esses filtros.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((i, n) => {
            const p = price(i);
            const a = avg(i);
            const d = discount(i);
            const both = moeda === "all";
            return (
              <Reveal as="li" key={i.id} index={n} step={0.025} max={14}>
                <div className="tile flex items-center gap-1 p-2 sm:gap-3 sm:p-2.5">
                  <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left sm:gap-3" onClick={() => setOpen(i)}>
                    <ItemSprite icon={i.icon} size={36} alt="" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 break-words text-[15px] font-bold leading-tight">{i.name}</span>
                      <span className="mt-1 flex items-center gap-1.5 text-xs text-mute">
                        <DealBadge d={deal(i)} />
                        <span className="truncate">{i.ads} anúncios</span>
                        {owned[i.id] ? <span className="shrink-0 rounded-md border border-[#7a5a1c] px-1.5 py-0.5 text-[11px] font-semibold text-poke-gold">você tem {fmtInt(owned[i.id])}</span> : null}
                        <span className="hidden sm:inline">· {fmtInt(i.units)} un.</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      {both ? (
                        <>
                          {i.minGold != null && <Money v={i.minGold} moeda="gold" short className="font-bold" />}
                          {i.minOrb != null && <Money v={i.minOrb} moeda="orb" short className="font-bold" />}
                        </>
                      ) : (
                        <Money v={p} moeda={moeda as Moeda} short className="font-bold" />
                      )}
                      <span className="flex items-center gap-1.5 text-xs text-mute">
                        {!both && a ? (
                          <span className="hidden items-center gap-1 sm:inline-flex">
                            méd. <Money v={a} moeda={moeda as Moeda} short />
                          </span>
                        ) : null}
                        {d > 0.001 && <span className="tnum text-poke-green">−{Math.round(d * 100)}%</span>}
                        {d <= 0.001 && premium(i) >= 0.15 && <span className="tnum text-poke-gold">+{Math.round(premium(i) * 100)}%</span>}
                      </span>
                    </span>
                  </button>
                  <button className="grid size-10 shrink-0 place-items-center rounded-lg text-mute transition-colors hover:text-fg" onClick={() => void toggleFav(i)} aria-pressed={i.fav} aria-label={i.fav ? "Tirar dos favoritos" : "Favoritar"}>
                    <Star className={`size-[18px] ${i.fav ? "fill-poke-gold text-poke-gold" : ""}`} />
                  </button>
                </div>
              </Reveal>
            );
          })}
        </ul>
      )}

      <AnimatePresence>
        {open && (
          <ItemDetail
            key={open.id}
            item={items.find((x) => x.id === open.id) ?? open}
            moeda={moeda === "all" ? "gold" : moeda}
            account={undefined}
            onClose={() => setOpen(null)}
            onFav={() => void toggleFav(items.find((x) => x.id === open.id) ?? open)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

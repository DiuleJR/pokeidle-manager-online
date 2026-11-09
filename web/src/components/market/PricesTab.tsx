import { AnimatePresence } from "framer-motion";
import { Bell, Crosshair, ShoppingCart, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "@/components/SettingsView";
import { ItemSprite } from "@/components/Sprites";
import { type Deal, type Listing, type MarketItem, type Moeda, dealLabel, marketApi, secondsUntil } from "@/lib/market";
import { fmtInt } from "@/lib/utils";
import { BuyDialog } from "./BuyDialog";
import { RuleDialog } from "./RulesTab";
import { CurrencyToggle, ErrorBox, LineChart, Loading, Money, fmtCountdown, useAsync, useTick } from "./shared";

const SORTS = [
  { id: "discount", label: "Maior desconto" },
  { id: "cheap", label: "Menor preço" },
  { id: "supply", label: "Mais ofertas" },
  { id: "name", label: "Nome" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

const DEAL_CLS: Record<string, string> = {
  barato: "border-[#2f6b3a] bg-[#16301c] text-poke-green",
  caro: "border-[#7a2f27] bg-[#32140f] text-poke-red",
  justo: "border-line bg-tile text-mute",
};
export function DealBadge({ d }: { d?: Deal }) {
  if (d !== "barato") return null; // só destaca o que vale a pena; o resto é ruído
  return <span className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-bold uppercase ${DEAL_CLS[d]}`}>{dealLabel(d)}</span>;
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
            {item.ads} anúncios · {fmtInt(item.units)} unidades
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            Média de 7 dias: <Money v={moeda === "orb" ? item.avgOrb : item.avgGold} moeda={moeda} />
            {moeda === "orb" && item.soldOrb ? <span className="text-xs text-mute">({fmtInt(item.soldOrb)} vendidos)</span> : null}
            {moeda === "gold" && item.soldGold ? <span className="text-xs text-mute">({fmtInt(item.soldGold)} vendidos)</span> : null}
          </p>
        </div>
        <button className="btn" onClick={onFav} aria-pressed={item.fav} title={item.fav ? "Tirar dos favoritos" : "Favoritar"}>
          <Star className={`size-4 ${item.fav ? "fill-poke-gold text-poke-gold" : ""}`} />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <CurrencyToggle value={moeda} onChange={setMoeda} />
        <div className="flex gap-1.5">
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
          <>
            <LineChart
              series={[
                { name: "Venda média", color: "#f3c04a", points: (sales.data?.sales ?? []).map((s) => ({ x: s.day, y: s.avg })) },
                {
                  name: "Menor preço anunciado",
                  color: "#5cc8e8",
                  points: (sales.data?.floor ?? [])
                    .filter((f) => (moeda === "orb" ? f.minOrb : f.minGold) != null)
                    .map((f) => ({ x: new Date(f.ts).toISOString().slice(0, 10), y: (moeda === "orb" ? f.minOrb : f.minGold) as number })),
                },
              ].filter((s) => s.points.length > 0)}
            />
          </>
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
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <Money v={l.preco} moeda={l.moeda} className="font-bold" />
                {best && l.preco > best && <span className="text-xs text-mute">+{Math.round(((l.preco - best) / best) * 100)}%</span>}
                <span className="tnum text-mute">{fmtInt(l.qtd)}×</span>
                <span className="min-w-0 flex-1 truncate text-mute">{l.vendedor}</span>
                {wait > 0 ? <span className="tnum text-xs text-poke-gold">libera em {fmtCountdown(wait)}</span> : null}
                <button className="btn" onClick={() => setBuy(l)} aria-label={`Comprar de ${l.vendedor}`}>
                  <ShoppingCart className="size-4" /> Comprar
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
  const [moeda, setMoeda] = useState<Moeda>("gold");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [onlyFav, setOnlyFav] = useState(false);
  const [sort, setSort] = useState<SortId>("discount");
  const [open, setOpen] = useState<MarketItem | null>(null);
  const ov = useAsync(() => marketApi.overview(), [], { every: 30000 });
  const [favs, setFavs] = useState<Record<number, boolean>>({});

  const items = useMemo(() => (ov.data?.items ?? []).map((i) => (i.id in favs ? { ...i, fav: favs[i.id] } : i)), [ov.data, favs]);
  const cats = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(), [items]);

  const price = (i: MarketItem) => (moeda === "orb" ? i.minOrb : i.minGold);
  const avg = (i: MarketItem) => (moeda === "orb" ? i.avgOrb : i.avgGold);
  const deal = (i: MarketItem) => (moeda === "orb" ? i.dealOrb : i.dealGold);
  const discount = (i: MarketItem) => {
    const p = price(i);
    const a = avg(i);
    return p && a ? (a - p) / a : -1;
  };

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const out = items.filter((i) => price(i) != null && (!t || i.name.toLowerCase().includes(t)) && (!cat || i.category === cat) && (!onlyFav || i.fav));
    out.sort((a, b) =>
      sort === "discount" ? discount(b) - discount(a) : sort === "cheap" ? (price(a) ?? 0) - (price(b) ?? 0) : sort === "supply" ? b.units - a.units : a.name.localeCompare(b.name),
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
      <div className="flex flex-wrap items-center gap-2">
        <input className="field min-w-0 flex-1 sm:max-w-xs" type="search" placeholder="Buscar item…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar item" />
        <CurrencyToggle value={moeda} onChange={setMoeda} />
        <button className="btn" data-active={onlyFav} aria-pressed={onlyFav} onClick={() => setOnlyFav(!onlyFav)} title="Só favoritos" aria-label="Só favoritos">
          <Star className={`size-4 ${onlyFav ? "fill-poke-gold" : ""}`} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="field" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c] ?? c}
            </option>
          ))}
        </select>
        <select className="field" value={sort} onChange={(e) => setSort(e.target.value as SortId)} aria-label="Ordenar">
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-mute">
          {rows.length} itens · <span className="text-poke-green">Barato</span> = 15% ou mais abaixo da média de {ov.data?.days ?? 7} dias
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="card p-8 text-center text-sm text-mute">Nenhum item com esses filtros.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((i) => {
            const p = price(i);
            const a = avg(i);
            const d = discount(i);
            return (
              <li key={i.id}>
                <div className="tile flex items-center gap-2.5 p-2 sm:gap-3 sm:p-2.5">
                  <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left sm:gap-3" onClick={() => setOpen(i)}>
                    <ItemSprite icon={i.icon} size={36} alt="" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-bold">{i.name}</span>
                        <DealBadge d={deal(i)} />
                      </span>
                      <span className="block truncate text-xs text-mute">
                        {i.ads} anúncios · {fmtInt(i.units)} un.
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <Money v={p} moeda={moeda} className="font-bold" />
                      <span className="flex items-center gap-1.5 text-xs text-mute">
                        {a ? (
                          <>
                            méd. <Money v={a} moeda={moeda} short />
                          </>
                        ) : (
                          "sem média"
                        )}
                        {d > 0.001 && <span className="tnum text-poke-green">−{Math.round(d * 100)}%</span>}
                      </span>
                    </span>
                  </button>
                  <button className="btn shrink-0" onClick={() => void toggleFav(i)} aria-pressed={i.fav} aria-label={i.fav ? "Tirar dos favoritos" : "Favoritar"}>
                    <Star className={`size-4 ${i.fav ? "fill-poke-gold text-poke-gold" : ""}`} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AnimatePresence>
        {open && (
          <ItemDetail
            key={open.id}
            item={items.find((x) => x.id === open.id) ?? open}
            moeda={moeda}
            account={undefined}
            onClose={() => setOpen(null)}
            onFav={() => void toggleFav(items.find((x) => x.id === open.id) ?? open)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

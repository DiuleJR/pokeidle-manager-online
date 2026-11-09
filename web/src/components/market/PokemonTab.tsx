import { AnimatePresence } from "framer-motion";
import { Reveal } from "@/components/ui";
import { Bell, ShoppingCart, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Check2 } from "@/components/SettingsView";
import { PokemonSprite, ShinyMark } from "@/components/Sprites";
import { type Listing, type Moeda, marketApi, secondsUntil } from "@/lib/market";
import { fmtInt } from "@/lib/utils";
import { BuyDialog } from "./BuyDialog";
import { RuleDialog } from "./RulesTab";
import { CurrencyToggle, ErrorBox, Loading, Money, type MoedaSel, Pager, fmtCountdown, useAsync, useTick } from "./shared";

const ELEMENTS = ["", "NORMAL", "FIRE", "WATER", "GRASS", "ELECTRIC", "ICE", "FIGHTING", "POISON", "GROUND", "FLYING", "PSYCHIC", "BUG", "ROCK", "GHOST", "DRAGON", "DARK", "STEEL", "FAIRY"];
const ORDERS = [
  { id: "baratos", label: "Mais baratos" },
  { id: "recentes", label: "Mais recentes" },
  { id: "caros", label: "Mais caros" },
];

/** Vitrine de Pokémon à venda. Os filtros avançados ficam recolhidos. */
export function PokemonTab() {
  const [moeda, setMoeda] = useState<MoedaSel>("gold");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [elemento, setElemento] = useState("");
  const [ordem, setOrdem] = useState("baratos");
  const [soShiny, setSoShiny] = useState(false);
  const [soP5, setSoP5] = useState(false);
  const [ivMin, setIvMin] = useState("");
  const [nivelMin, setNivelMin] = useState("");
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [buy, setBuy] = useState<Listing | null>(null);
  const [alert, setAlert] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(Date.now());

  const active = [elemento, ivMin, nivelMin, soShiny, soP5, ordem !== "baratos"].filter(Boolean).length;

  const res = useAsync(
    async () => {
      const ask = (m: Moeda) =>
        marketApi.vitrine({
          moeda: m, ordem, busca: applied, elemento, pagina: page, soShiny, soP5,
          ivMin: ivMin ? Number(ivMin) : null, nivelMin: nivelMin ? Number(nivelMin) : null,
        });
      // "Tudo": consulta as duas moedas e junta (Gemas primeiro, depois Gold)
      const r =
        moeda === "all"
          ? await Promise.all([ask("orb"), ask("gold")]).then(([o, g]) => ({
              ...o,
              total: (o.total ?? 0) + (g.total ?? 0),
              listings: [...o.listings, ...g.listings],
              both: true,
              more: (o.total != null ? (page + 1) * (o.perPage ?? 24) < o.total : o.listings.length >= 24) || (g.total != null ? (page + 1) * (g.perPage ?? 24) < g.total : g.listings.length >= 24),
            }))
          : { ...(await ask(moeda)), both: false, more: undefined };
      setFetchedAt(Date.now());
      return r;
    },
    [moeda, ordem, applied, elemento, page, soShiny, soP5, ivMin, nivelMin],
    { every: 20000 },
  );
  useTick();
  const drift = res.data ? res.data.now - fetchedAt : 0;
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };
  const rows = res.data?.listings ?? [];
  const perPage = res.data?.perPage ?? 24;
  const hasMore = res.data?.more !== undefined ? res.data.more : res.data?.total != null ? (page + 1) * perPage < res.data.total : rows.length >= perPage;

  return (
    <div className="space-y-3">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(q.trim());
          setPage(0);
        }}
      >
        <div className="flex gap-2 sm:w-72">
          <input className="field min-w-0 flex-1" type="search" placeholder="Nome do Pokémon…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Nome do Pokémon" maxLength={40} />
          <button className="btn shrink-0" type="submit">
            Buscar
          </button>
        </div>
        <div className="flex gap-2">
          <CurrencyToggle value={moeda} onChange={reset(setMoeda)} allowAll className="min-w-0 flex-1 sm:flex-none" />
          <button className="btn shrink-0" type="button" data-active={showFilters || active > 0} onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters} aria-label="Filtros">
            <SlidersHorizontal className="size-4" />
            <span className="hidden sm:inline">Filtros</span>
            {active ? <span className="tnum">({active})</span> : null}
          </button>
        </div>
      </form>

      {showFilters && (
        <div className="tile space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select className="field" value={elemento} onChange={(e) => reset(setElemento)(e.target.value)} aria-label="Tipo">
              {ELEMENTS.map((x) => (
                <option key={x} value={x}>
                  {x || "Todos os tipos"}
                </option>
              ))}
            </select>
            <select className="field" value={ordem} onChange={(e) => reset(setOrdem)(e.target.value)} aria-label="Ordem">
              {ORDERS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <input className="field w-24" inputMode="numeric" placeholder="IV mín. %" value={ivMin} onChange={(e) => reset(setIvMin)(e.target.value.replace(/\D/g, ""))} aria-label="IV mínimo" />
            <input className="field w-24" inputMode="numeric" placeholder="Nível mín." value={nivelMin} onChange={(e) => reset(setNivelMin)(e.target.value.replace(/\D/g, ""))} aria-label="Nível mínimo" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Check2 checked={soShiny} onChange={reset(setSoShiny)}>
              ✨ Só shiny
            </Check2>
            <Check2 checked={soP5} onChange={reset(setSoP5)}>
              Só P5
            </Check2>
            <button className="btn ml-auto" type="button" onClick={() => setAlert(true)}>
              <Bell className="size-4" /> Avisar no Discord com estes filtros
            </button>
          </div>
        </div>
      )}

      {res.loading && !res.data ? (
        <Loading text="Consultando a vitrine…" />
      ) : res.error && !res.data ? (
        <ErrorBox error={res.error} onRetry={res.reload} />
      ) : rows.length === 0 ? (
        <p className="card p-8 text-center text-sm text-mute">Nenhum Pokémon com esses filtros.</p>
      ) : (
        <>
          {res.data?.total != null && <p className="text-xs text-mute">{fmtInt(res.data.total)} anúncios</p>}
          <ul className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
            {rows.map((l, n) => {
              const f = l.ficha ?? {};
              const wait = secondsUntil(l.compravelEm, drift);
              const iv = f.ivTotal != null ? Math.round((f.ivTotal / 192) * 100) : null;
              return (
                <Reveal as="li" key={l.id} index={n} step={0.025} max={14} className="tile flex items-center gap-2.5 p-2 sm:gap-3 sm:p-2.5">
                  <PokemonSprite looktype={f.looktype} size={56} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-1.5 leading-tight">
                      <span className="break-words text-[15px] font-bold">{f.nome ?? "Pokémon"}</span>
                      {f.shiny && <ShinyMark />}
                      <span className="shrink-0 text-xs text-mute">nv. {f.level ?? "?"}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-x-2 text-xs text-mute">
                      {iv != null && <span className="shrink-0">IV {iv}%</span>}
                      {f.potencia != null && <span className="shrink-0">P{f.potencia}</span>}
                      <span className="truncate">{l.vendedor}</span>
                    </p>
                    {wait > 0 && <p className="tnum mt-0.5 text-xs text-poke-gold">libera em {fmtCountdown(wait)}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Money v={l.preco} moeda={l.moeda} short className="text-[15px] font-bold" />
                    <button className="btn !px-3" onClick={() => setBuy(l)} aria-label={`Comprar ${f.nome ?? "Pokémon"}`}>
                      <ShoppingCart className="size-4" />
                      <span className="hidden sm:inline">Comprar</span>
                    </button>
                  </div>
                </Reveal>
              );
            })}
          </ul>
          <Pager page={page} onPage={setPage} hasMore={hasMore} />
        </>
      )}

      <AnimatePresence>
        {buy && <BuyDialog listing={buy} name={buy.ficha?.nome ?? "Pokémon"} onClose={() => setBuy(null)} onDone={() => void res.reload()} />}
        {alert && (
          <RuleDialog
            kind="alert"
            preset={{ target: "pokemon", busca: applied, elemento, so_shiny: soShiny, so_p5: soP5, iv_min: ivMin ? Number(ivMin) : null, nivel_min: nivelMin ? Number(nivelMin) : null, moeda: moeda === "all" ? "gold" : moeda }}
            onClose={() => setAlert(false)}
            onSaved={() => setAlert(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

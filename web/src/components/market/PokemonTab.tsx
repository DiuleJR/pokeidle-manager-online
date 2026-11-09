import { AnimatePresence } from "framer-motion";
import { Bell, ShoppingCart, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Check2 } from "@/components/SettingsView";
import { PokemonSprite, ShinyMark } from "@/components/Sprites";
import { type Listing, type Moeda, marketApi, secondsUntil } from "@/lib/market";
import { fmtInt } from "@/lib/utils";
import { BuyDialog } from "./BuyDialog";
import { RuleDialog } from "./RulesTab";
import { CurrencyToggle, ErrorBox, Loading, Money, Pager, fmtCountdown, useAsync, useTick } from "./shared";

const ELEMENTS = ["", "NORMAL", "FIRE", "WATER", "GRASS", "ELECTRIC", "ICE", "FIGHTING", "POISON", "GROUND", "FLYING", "PSYCHIC", "BUG", "ROCK", "GHOST", "DRAGON", "DARK", "STEEL", "FAIRY"];
const ORDERS = [
  { id: "baratos", label: "Mais baratos" },
  { id: "recentes", label: "Mais recentes" },
  { id: "caros", label: "Mais caros" },
];

/** Vitrine de Pokémon à venda. Os filtros avançados ficam recolhidos. */
export function PokemonTab() {
  const [moeda, setMoeda] = useState<Moeda>("gold");
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
      const r = await marketApi.vitrine({
        moeda, ordem, busca: applied, elemento, pagina: page, soShiny, soP5,
        ivMin: ivMin ? Number(ivMin) : null, nivelMin: nivelMin ? Number(nivelMin) : null,
      });
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
  const hasMore = res.data?.total != null ? (page + 1) * perPage < res.data.total : rows.length >= perPage;

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(q.trim());
          setPage(0);
        }}
      >
        <input className="field min-w-0 flex-1 sm:max-w-xs" type="search" placeholder="Nome do Pokémon…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Nome do Pokémon" maxLength={40} />
        <CurrencyToggle value={moeda} onChange={reset(setMoeda)} />
        <button className="btn" type="button" data-active={showFilters || active > 0} onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>
          <SlidersHorizontal className="size-4" /> Filtros{active ? ` (${active})` : ""}
        </button>
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
            {rows.map((l) => {
              const f = l.ficha ?? {};
              const wait = secondsUntil(l.compravelEm, drift);
              const iv = f.ivTotal != null ? Math.round((f.ivTotal / 192) * 100) : null;
              return (
                <li key={l.id} className="tile flex items-center gap-3 p-2.5">
                  <PokemonSprite looktype={f.looktype} size={64} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-bold">
                      <span className="truncate">{f.nome ?? "Pokémon"}</span>
                      {f.shiny && <ShinyMark />}
                      <span className="shrink-0 font-normal text-mute">nv. {f.level ?? "?"}</span>
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-mute">
                      {iv != null && <span>IV {iv}%</span>}
                      {f.potencia != null && <span>P{f.potencia}</span>}
                      <span className="truncate">{l.vendedor}</span>
                    </p>
                    {wait > 0 && <p className="tnum text-xs text-poke-gold">libera em {fmtCountdown(wait)}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Money v={l.preco} moeda={l.moeda} className="text-base font-bold" />
                    <button className="btn" onClick={() => setBuy(l)} aria-label={`Comprar ${f.nome ?? "Pokémon"}`}>
                      <ShoppingCart className="size-4" /> Comprar
                    </button>
                  </div>
                </li>
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
            preset={{ target: "pokemon", busca: applied, elemento, so_shiny: soShiny, so_p5: soP5, iv_min: ivMin ? Number(ivMin) : null, nivel_min: nivelMin ? Number(nivelMin) : null, moeda }}
            onClose={() => setAlert(false)}
            onSaved={() => setAlert(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

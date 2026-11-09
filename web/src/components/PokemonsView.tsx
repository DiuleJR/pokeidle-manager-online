import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { PokemonSprite, ShinyMark } from "@/components/Sprites";
import { Coin, ConfirmDialog } from "@/components/ui";
import { sellDepot, usePokemons } from "@/lib/api";
import { useAccountsMap } from "@/lib/telemetry";
import type { PokemonRow, SellDepotResult } from "@/lib/types";
import { fmtInt, fmtShort } from "@/lib/utils";
import type { Valuation } from "@/lib/valuation";

const EASE = [0.22, 1, 0.36, 1] as const;

const PAGE = 50;
type SortKey = "power" | "level" | "grade" | "iv" | "recent" | "name";

const SORTS: Record<SortKey, { label: string; fn: (a: PokemonRow, b: PokemonRow) => number }> = {
  power: { label: "Poder", fn: (a, b) => (b.power ?? 0) - (a.power ?? 0) },
  level: { label: "Nível", fn: (a, b) => b.level - a.level },
  grade: { label: "Nota", fn: (a, b) => (b.grade ?? 0) - (a.grade ?? 0) },
  iv: { label: "IV total", fn: (a, b) => b.ivTotal - a.ivTotal },
  recent: { label: "Mais recentes", fn: (a, b) => (b.caughtAt ?? 0) - (a.caughtAt ?? 0) },
  name: { label: "Nome (A–Z)", fn: (a, b) => a.name.localeCompare(b.name) },
};

/** Todos os Pokémons de uma conta ou de todas juntas (lista vinda de /api/pokemons). */
/** Valor estimado de um shiny, ao lado do nome. */
function GemTag({ v }: { v: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-mute tnum" title="Valor estimado (mediana das vendas recentes da espécie)">
      <Coin kind="gem" size={12} />
      {fmtShort(Math.round(v))}
    </span>
  );
}

export function PokemonsView({ account, valuation }: { account: string; valuation?: Valuation | null }) {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { rows, error } = usePokemons(account, refreshNonce);
  const accounts = useAccountsMap();
  const shinyGems = useMemo(() => new Map((valuation?.shinies ?? []).map((v) => [`${v.account}-${v.id}`, v.gems])), [valuation]);
  const gemsOf = (p: PokemonRow) => (p.shiny ? shinyGems.get(`${Number(p.account.replace(/[^0-9]/g, ""))}-${p.id}`) : null);
  const [query, setQuery] = useState("");
  const [shiny, setShiny] = useState(false);
  const [team, setTeam] = useState(false);
  const [sort, setSort] = useState<SortKey>("power");
  const [page, setPage] = useState(0);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selling, setSelling] = useState(false);
  const [sellResult, setSellResult] = useState<SellDepotResult[] | null>(null);
  const [sellFailed, setSellFailed] = useState<string | null>(null);

  useEffect(() => setPage(0), [query, shiny, team, sort, account]);

  const nick = (id: string) => accounts[id]?.nick ?? id;
  const targetLabel = account === "all" ? `todas as ${Object.keys(accounts).length} contas` : nick(account);

  async function handleConfirmSell() {
    setSelling(true);
    setSellFailed(null);
    try {
      const results = await sellDepot(account);
      setSellResult(results);
      setConfirmOpen(false);
      // dá um instante para o servidor consolidar o estado antes de recarregar a lista
      setTimeout(() => setRefreshNonce((n) => n + 1), 1200);
    } catch (e) {
      setSellFailed(e instanceof Error ? e.message : "Falha ao vender o Depot.");
    } finally {
      setSelling(false);
    }
  }

  const shown = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows
      .filter((p) => (!shiny || p.shiny) && (!team || p.slot !== null) && (!q || p.name.toLowerCase().includes(q)))
      .sort(SORTS[sort].fn);
  }, [rows, query, shiny, team, sort]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice(page * PAGE, (page + 1) * PAGE);

  return (
    <div className="card p-2.5 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input className="field w-full sm:w-64" placeholder="Buscar Pokémon" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="-mx-0.5 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-0.5 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          <button className="btn shrink-0" data-active={shiny} onClick={() => setShiny((v) => !v)}>
            ✨ Shiny
          </button>
          <button className="btn shrink-0" data-active={team} onClick={() => setTeam((v) => !v)}>
            No time
          </button>
          <select className="field w-auto shrink-0 sm:ml-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>
                Ordenar: {v.label}
              </option>
            ))}
          </select>
          <button
            className="btn shrink-0 border-poke-red/40 text-poke-red hover:border-poke-red hover:bg-[#2a150f]"
            onClick={() => {
              setSellFailed(null);
              setConfirmOpen(true);
            }}
          >
            Vender Depot
          </button>
        </div>
      </div>

      <AnimatePresence>
        {sellResult && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 10 }}
            exit={{ opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="tile-gold tile space-y-1 px-3 py-2.5 text-sm">
              {sellResult.every((r) => r.ok && !r.qty) ? (
                <div className="font-semibold text-fg">Nenhum Pokémon vendável no Depot dessa seleção.</div>
              ) : (
                <>
                  <div className="font-semibold text-fg">
                    Depot vendido: {fmtInt(sellResult.reduce((s, r) => s + (r.qty ?? 0), 0))} Pokémon por{" "}
                    <span className="text-poke-gold">{fmtShort(sellResult.reduce((s, r) => s + (r.gained ?? 0), 0))}</span> Gold.
                  </div>
                  {sellResult.length > 1 && (
                    <ul className="space-y-0.5 text-mute">
                      {sellResult.map((r) => (
                        <li key={r.account}>
                          {r.nick}: {r.ok ? `${fmtInt(r.qty ?? 0)} vendidos · ${fmtShort(r.gained ?? 0)} Gold` : <span className="text-poke-red">{r.error}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {sellResult.some((r) => !r.ok) && sellResult.length === 1 && (
                    <div className="text-poke-red">{sellResult[0].error}</div>
                  )}
                </>
              )}
              <button className="text-xs font-semibold text-mute underline underline-offset-2 hover:text-fg" onClick={() => setSellResult(null)}>
                Fechar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-2.5 border-t border-line pt-2.5 sm:mt-3 sm:pt-3">
        {error && !rows && <p className="py-10 text-center text-poke-red">Não foi possível carregar os Pokémons ({error}).</p>}
        {!rows && !error && <p className="py-10 text-center text-mute">Carregando…</p>}

        {rows && (
          <>
            <div className="mb-2 text-sm text-mute">
              {fmtInt(shown.length)} de {fmtInt(rows.length)} Pokémons
            </div>
            <ul className="space-y-1.5 md:hidden">
              {slice.map((p, i) => (
                <motion.li
                  key={`${p.account}-${p.id}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: Math.min(i, 12) * 0.02 }}
                  className="tile flex items-center gap-2.5 px-2.5 py-1.5"
                >
                  <PokemonSprite looktype={p.looktype} size={52} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <span className="truncate">{p.name}</span>
                      {p.shiny && <ShinyMark />}
                      {gemsOf(p) ? <GemTag v={gemsOf(p) as number} /> : null}
                      {p.slot !== null && <span className="rounded bg-poke-blue px-1 py-0.5 text-[9px] font-bold leading-none text-void">TIME</span>}
                    </div>
                    <div className="truncate text-xs text-mute">
                      {account === "all" && <>{nick(p.account)} · </>}Nv. {fmtInt(p.level)} · IV {p.ivTotal}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tnum text-sm font-bold">{fmtShort(p.power ?? 0)}</div>
                    <div className="tnum text-xs text-mute">{p.grade?.toFixed(2) ?? "—"}</div>
                  </div>
                </motion.li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left">
                <thead>
                  <tr className="label border-b-2 border-line">
                    <th className="py-2 pr-2 font-normal">Pokémon</th>
                    {account === "all" && <th className="px-2 py-2 font-normal">Conta</th>}
                    <th className="px-2 py-2 text-right font-normal">Nv.</th>
                    <th className="px-2 py-2 text-right font-normal">Poder</th>
                    <th className="px-2 py-2 text-right font-normal">Nota</th>
                    <th className="px-2 py-2 text-right font-normal">IV</th>
                    <th className="py-2 pl-3 font-normal">Tipos</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((p) => (
                    <tr key={`${p.account}-${p.id}`} className="border-b border-line transition-colors duration-150 hover:bg-tile">
                      <td className="py-1 pr-2">
                        <span className="flex items-center gap-2 font-semibold">
                          <PokemonSprite looktype={p.looktype} size={48} />
                          {p.name}
                          {p.shiny && <ShinyMark />}
                          {gemsOf(p) ? <GemTag v={gemsOf(p) as number} /> : null}
                          {p.slot !== null && (
                            <span className="rounded bg-poke-blue px-1.5 py-0.5 text-[10px] font-bold leading-none text-void">
                              TIME
                            </span>
                          )}
                        </span>
                      </td>
                      {account === "all" && <td className="px-2 py-1 text-mute">{nick(p.account)}</td>}
                      <td className="tnum px-2 py-1 text-right">{fmtInt(p.level)}</td>
                      <td className="tnum px-2 py-1 text-right">{fmtInt(p.power ?? 0)}</td>
                      <td className="tnum px-2 py-1 text-right">{p.grade?.toFixed(2) ?? "—"}</td>
                      <td className="tnum px-2 py-1 text-right">{p.ivTotal}</td>
                      <td className="py-1 pl-3 text-sm capitalize text-mute">{p.types.map((t) => t.toLowerCase()).join(" / ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                ← Anterior
              </button>
              <span className="text-sm text-mute">
                Página {page + 1} de {pages}
              </span>
              <button className="btn" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                Próxima →
              </button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Vender todo o Depot?"
        busy={selling}
        onCancel={() => !selling && setConfirmOpen(false)}
        onConfirm={handleConfirmSell}
        confirmLabel="Vender Depot"
        message={
          <>
            Isso vai vender <b className="text-fg">todos os Pokémon não trancados</b> do Depot de{" "}
            <b className="text-fg">{targetLabel}</b>. Os protegidos/trancados ficam preservados.
            <br />
            <br />
            <b className="text-poke-red">Esta ação não pode ser desfeita.</b>
            {sellFailed && <div className="mt-2 text-poke-red">{sellFailed}</div>}
          </>
        }
      />
    </div>
  );
}

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Save, Search, SlidersHorizontal, Trash2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { TypeChip } from "@/components/HuntRow";
import { Board, RosterCard, rangeLabel, type Placement } from "@/components/PvpBoard";
import { PokemonSheet } from "@/components/PokemonSheet";
import { PokemonSprite } from "@/components/Sprites";
import { fillHouses, rangeBadge, TEAM_MAX, teamApi, type RosterPage, type RosterQuery, type RosterRow } from "@/lib/pvpTeam";
import { TYPES } from "@/lib/typeChart";

const EASE = [0.22, 1, 0.36, 1] as const;
const VIOLET = "#b66bff";
const nf = new Intl.NumberFormat("pt-BR");
const PAGE = 60;
const DEFAULT_QUERY: RosterQuery = { q: "", tipo: "", iv: 0, shiny: false, local: "todos", ord: "poder" };
const ORDERS: [RosterQuery["ord"], string][] = [
  ["poder", "Poder na luta"],
  ["nivel", "Nível"],
  ["nota", "Nota"],
  ["iv", "IV somado"],
  ["qualidade", "Qualidade"],
  ["pve", "Poder no PVE"],
];

export function PvpTeamEditor({ account, nick, levelMin, onClose, onSaved }: { account: number; nick: string; levelMin: number; onClose: () => void; onSaved: () => void }) {
  const [ids, setIds] = useState<number[]>([]);
  const [placement, setPlacement] = useState<Placement>({});
  const [members, setMembers] = useState<Map<number, RosterRow>>(new Map());
  const [query, setQuery] = useState<RosterQuery>(DEFAULT_QUERY);
  const [debounced, setDebounced] = useState<RosterQuery>(DEFAULT_QUERY);
  const [page, setPage] = useState<RosterPage | null>(null);
  const [items, setItems] = useState<RosterRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [sheet, setSheet] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [initial, setInitial] = useState("");
  const [view, setView] = useState<"board" | "list">("board");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const reqId = useRef(0);

  const remember = useCallback((rows: RosterRow[]) => setMembers((m) => { const n = new Map(m); rows.forEach((r) => n.set(r.id, r)); return n; }), []);

  // equipe atual
  useEffect(() => {
    let live = true;
    teamApi.teamView(account).then((v) => {
      if (!live) return;
      remember(v.members);
      setIds(v.ids);
      const pl: Placement = {};
      v.ids.forEach((id) => (pl[id] = v.casas[String(id)]));
      setPlacement(pl);
      setInitial(JSON.stringify([v.ids, v.ids.map((id) => pl[id])]));
      setReady(true);
    }).catch((e) => live && setErr(e instanceof Error ? e.message : "Falha ao ler a equipe"));
    return () => { live = false; };
  }, [account, remember]);

  // busca com atraso curto
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const loadList = useCallback(async (q: RosterQuery, offset: number) => {
    const id = ++reqId.current;
    setLoadingList(true);
    try {
      const p = await teamApi.roster(account, q, offset, PAGE);
      if (id !== reqId.current) return;
      setPage(p);
      remember(p.items);
      setItems((cur) => (offset === 0 ? p.items : [...cur, ...p.items]));
    } catch (e) {
      if (id === reqId.current) setErr(e instanceof Error ? e.message : "Falha ao ler os Pokémon");
    } finally {
      if (id === reqId.current) setLoadingList(false);
    }
  }, [account, remember]);
  useEffect(() => { void loadList(debounced, 0); }, [debounced, loadList]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !sheet && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, sheet, saving]);

  const rangeOf = (id: number) => members.get(id)?.range ?? 1;
  const auto = useCallback((list: number[], keep: Placement = {}) => {
    const houses = fillHouses(list.map((id) => keep[id]), list.map(rangeOf));
    const pl: Placement = {};
    list.forEach((id, i) => (pl[id] = houses[i]));
    return pl;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  const add = (id: number, house?: number) => {
    setErr("");
    if (ids.includes(id)) return;
    if (ids.length >= TEAM_MAX) return setErr(`A equipe já tem ${TEAM_MAX} Pokémon. Tire um antes.`);
    const list = [...ids, id];
    const keep: Placement = { ...placement };
    if (house != null && !Object.values(placement).includes(house)) keep[id] = house;
    setIds(list);
    setPlacement(auto(list, keep));
  };
  const remove = (id: number) => {
    const list = ids.filter((x) => x !== id);
    const pl = { ...placement };
    delete pl[id];
    setIds(list);
    setPlacement(pl);
    setSelected((s) => (s === id ? null : s));
    setErr("");
  };
  const toggle = (id: number) => (ids.includes(id) ? remove(id) : add(id));

  const moveTo = (id: number, house: number) => {
    const other = ids.find((x) => x !== id && placement[x] === house);
    setPlacement((pl) => {
      const n = { ...pl };
      if (other != null) n[other] = pl[id];
      n[id] = house;
      return n;
    });
  };
  const onTileClick = (house: number) => {
    const here = ids.find((x) => placement[x] === house);
    if (selected == null) {
      if (here != null) setSelected(here);
      return;
    }
    if (here === selected) return setSelected(null);
    moveTo(selected, house);
    setSelected(null);
  };
  const onDropTile = (house: number, payload: string) => {
    const [kind, raw] = payload.split(":");
    const id = Number(raw);
    if (!Number.isFinite(id)) return;
    if (kind === "tile") return moveTo(id, house);
    if (kind !== "pk") return;
    const here = ids.find((x) => placement[x] === house);
    if (ids.includes(id)) return moveTo(id, house);
    if (here != null) {                        // solta em cima de outro: troca o Pokémon daquela casa
      const list = ids.map((x) => (x === here ? id : x));
      const keep: Placement = { ...placement, [id]: house };
      delete keep[here];
      setIds(list);
      setPlacement(auto(list, keep));
      return;
    }
    add(id, house);
  };

  const power = ids.reduce((s, id) => s + (members.get(id)?.pvpPower ?? 0), 0);
  const dirty = ready && JSON.stringify([ids, ids.map((id) => placement[id])]) !== initial;

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      await teamApi.save(account, ids, Object.fromEntries(ids.map((id) => [String(id), placement[id]])));
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não consegui salvar a equipe");
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof RosterQuery>(k: K, v: RosterQuery[K]) => setQuery((q) => ({ ...q, [k]: v }));
  const field = "field !h-9 min-w-0 text-sm";
  const team = ids.map((id) => members.get(id)).filter((m): m is RosterRow => !!m);
  const byRange = [1, 2, 3, 4].map((r) => ({ r, n: team.filter((m) => m.range === r).length })).filter((x) => x.n > 0);
  const typeCount = new Map<string, number>();
  team.forEach((m) => m.types.forEach((t) => typeCount.set(t, (typeCount.get(t) ?? 0) + 1)));
  const typeList = [...typeCount.entries()].sort((a, b) => b[1] - a[1]);
  const sel = selected != null ? members.get(selected) : undefined;

  const activeFilters = (query.local !== "todos" ? 1 : 0) + (query.tipo ? 1 : 0) + (query.iv ? 1 : 0) + (query.ord !== "poder" ? 1 : 0) + (query.shiny ? 1 : 0);
  const full = ids.length >= TEAM_MAX;

  const teamStrip = (
    <ul className="grid min-w-0 flex-1 grid-cols-5 gap-1.5" aria-label="Equipe">
      {Array.from({ length: TEAM_MAX }, (_, i) => {
        const m = team[i];
        if (!m) return <li key={i} className="min-h-12 rounded-lg border border-dashed border-line" />;
        const on = selected === m.id;
        return (
          <li key={m.id} className="relative min-w-0">
            <button type="button" onClick={() => setSelected(on ? null : m.id)} aria-pressed={on} className="flex h-full w-full flex-col items-center gap-0.5 rounded-lg border-2 bg-[#1d2740] px-1 py-1 text-center sm:flex-row sm:gap-1.5 sm:px-1.5 sm:text-left" style={{ borderColor: on ? VIOLET : "#4a8fd0" }}>
              <span className="pointer-events-none shrink-0"><PokemonSprite looktype={m.looktype} size={34} /></span>
              <span className="min-w-0">
                <span className="hidden truncate text-xs font-bold leading-tight sm:block">{m.name}</span>
                <span className="tnum block truncate text-[11px] font-extrabold leading-tight text-poke-gold">⚔ {nf.format(m.pvpPower)}</span>
              </span>
              <span className="absolute bottom-0.5 left-0.5 text-[10px] leading-none" aria-hidden>{rangeBadge(m.range)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  const rangeChips = byRange.map(({ r, n }) => (
    <span key={r} className="tnum inline-flex items-center gap-1 rounded-full border border-line bg-tile px-2 py-0.5 text-xs font-bold" title={rangeLabel(r)}>{r > 1 ? `${r}🏹` : "🗡️"} {n}</span>
  ));
  const typeChips = <span className="flex flex-wrap gap-1">{typeList.map(([t, n]) => <TypeChip key={t} type={t} mult={n > 1 ? n : undefined} />)}</span>;
  const tools = (
    <>
      <button type="button" className="btn" disabled={ids.length === 0 || saving} onClick={() => setPlacement(auto(ids))}><Wand2 className="size-4" aria-hidden /> Auto-posicionar</button>
      <button type="button" className="btn" disabled={ids.length === 0 || saving} onClick={() => { setIds([]); setPlacement({}); setSelected(null); }}><Trash2 className="size-4" aria-hidden /> Limpar</button>
    </>
  );
  const saveBtn = (cls = "") => (
    <button type="button" className={`btn font-bold ${cls}`} style={{ borderColor: VIOLET, color: VIOLET }} disabled={saving || ids.length === 0 || !dirty} onClick={() => void save()}>
      {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />} {dirty || saving ? "Salvar equipe" : "Equipe salva"}
    </button>
  );
  const errBox = (
    <AnimatePresence>
      {err && <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-2 rounded-md bg-poke-red/10 px-2 py-1 text-xs text-poke-red" role="alert">{err}</motion.p>}
    </AnimatePresence>
  );
  const tabCls = (on: boolean) => `flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-bold transition-colors ${on ? "bg-[#3a2352] text-white shadow-inner" : "text-mute hover:text-white"}`;
  const vagas = TEAM_MAX - ids.length;

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-0 backdrop-blur-sm sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`Equipe de PVP de ${nick}`}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        className="card flex h-[100dvh] w-full max-w-[1400px] flex-col overflow-hidden rounded-none sm:h-[96dvh] sm:rounded-2xl"
      >
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 sm:px-4">
          <h2 className="min-w-0 truncate text-base font-extrabold uppercase tracking-wide sm:text-lg">
            Equipe de PVP <span className="font-semibold normal-case text-mute">· {nick}</span>
          </h2>
          <button type="button" className="btn" onClick={onClose} disabled={saving} aria-label="Fechar o editor"><X className="size-4" aria-hidden /></button>
        </header>

        <div className="flex gap-1 border-b border-line bg-[#150e08] p-1.5 lg:hidden" role="tablist" aria-label="Partes do editor">
          <button type="button" role="tab" aria-selected={view === "board"} className={tabCls(view === "board")} onClick={() => setView("board")}>
            Tabuleiro <span className="tnum rounded-full bg-black/40 px-1.5 text-xs">{ids.length}/{TEAM_MAX}</span>
          </button>
          <button type="button" role="tab" aria-selected={view === "list"} className={tabCls(view === "list")} onClick={() => setView("list")}>
            Escolher Pokémon {page && <span className="tnum rounded-full bg-black/40 px-1.5 text-xs">{nf.format(page.total)}</span>}
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 sm:p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:overflow-hidden">
          <div className={`${view === "board" ? "block" : "hidden"} relative min-w-0 lg:block lg:min-h-0`}>
            {sel ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg border-2 bg-[#2a1738] px-2 py-1.5 shadow-lg lg:absolute lg:inset-x-3 lg:top-3 lg:z-20 lg:mb-0 lg:bg-[#2a1738]/95" style={{ borderColor: VIOLET }} role="status">
                <span className="pointer-events-none shrink-0"><PokemonSprite looktype={sel.looktype} size={30} /></span>
                <span className="min-w-0 flex-1 text-sm font-bold leading-tight">
                  <span className="block truncate">{sel.name}</span>
                  <span className="block text-[11px] font-semibold text-mute">Toque numa casa para mover</span>
                </span>
                <button type="button" className="btn !px-2 !py-1 text-xs" onClick={() => setSheet(sel.id)}>Ficha</button>
                <button type="button" className="btn !px-2 !py-1 text-xs" onClick={() => remove(sel.id)}>Tirar</button>
                <button type="button" className="btn !px-2 !py-1" onClick={() => setSelected(null)} aria-label="Cancelar a seleção"><X className="size-3.5" aria-hidden /></button>
              </div>
            ) : (
              <p className="mb-2 flex min-h-[3.4rem] items-center text-xs text-mute lg:hidden">
                {ids.length === 0 ? "Sua equipe está vazia. Abra “Escolher Pokémon” e toque em quem você quer levar." : "Toque num Pokémon e depois numa casa para mudar de lugar."}
              </p>
            )}
            <Board ids={ids} placement={placement} members={members} selected={selected} onTileClick={onTileClick} onDropTile={onDropTile} onRemove={remove} onInfo={setSheet} />

            <div className="mt-3 space-y-2 lg:hidden">
              <div className="flex flex-wrap items-center gap-1.5">
                {rangeChips}
                {typeChips}
              </div>
              <div className="flex">{teamStrip}</div>
              <div className="flex flex-wrap gap-2">{tools}</div>
              {vagas > 0 && <button type="button" className="btn w-full justify-center" onClick={() => setView("list")}><Search className="size-4" aria-hidden /> Escolher Pokémon ({vagas} vaga{vagas > 1 ? "s" : ""})</button>}
            </div>
          </div>

          <div className={`${view === "list" ? "flex" : "hidden"} min-w-0 flex-col gap-2 lg:flex lg:min-h-0`}>
            <div className="sticky top-[-0.75rem] z-10 -mx-3 -mt-3 space-y-2 bg-[#1a1109] px-3 pb-2 pt-3 sm:-mx-4 sm:-mt-4 sm:px-4 sm:pt-4 lg:static lg:m-0 lg:bg-transparent lg:p-0">
              <div className="flex items-center gap-2">
                <label className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-mute" aria-hidden />
                  <input className={`${field} w-full !pl-8`} placeholder="Buscar por nome ou tipo" aria-label="Buscar por nome ou tipo" value={query.q} onChange={(e) => set("q", e.target.value)} />
                </label>
                <button type="button" className="btn relative !h-9 shrink-0 lg:hidden" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
                  <SlidersHorizontal className="size-4" aria-hidden /> Filtros
                  {activeFilters > 0 && <span className="tnum absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-[#b66bff] text-[10px] font-extrabold text-black">{activeFilters}</span>}
                </button>
                <label className="hidden shrink-0 items-center gap-1.5 text-xs font-semibold text-mute lg:flex">
                  <input type="checkbox" checked={query.shiny} onChange={(e) => set("shiny", e.target.checked)} className="size-4 accent-[#b66bff]" /> Só shiny
                </label>
                <div className="tnum hidden shrink-0 text-right text-[11px] text-mute lg:block" aria-live="polite">{page ? `${nf.format(page.total)} de ${nf.format(page.owned)}` : "…"}</div>
              </div>
              <div className={`${filtersOpen ? "grid" : "hidden"} grid-cols-2 gap-2 sm:grid-cols-4 lg:grid`}>
                <label className="min-w-0 text-[11px] font-bold text-mute">Onde está
                  <select className={`${field} mt-0.5 w-full`} value={query.local} onChange={(e) => set("local", e.target.value as RosterQuery["local"])}>
                    <option value="todos">Todos</option><option value="equipe">Equipe da hunt</option><option value="colecao">Coleção</option>
                  </select>
                </label>
                <label className="min-w-0 text-[11px] font-bold text-mute">Tipo
                  <select className={`${field} mt-0.5 w-full`} value={query.tipo} onChange={(e) => set("tipo", e.target.value)}>
                    <option value="">Todos os tipos</option>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="min-w-0 text-[11px] font-bold text-mute">IV mínimo
                  <input className={`${field} mt-0.5 w-full`} inputMode="numeric" placeholder="Qualquer" value={query.iv || ""} onChange={(e) => set("iv", Math.max(0, Math.min(192, Number(e.target.value.replace(/\D/g, "")) || 0)))} />
                </label>
                <label className="min-w-0 text-[11px] font-bold text-mute">Ordenar por
                  <select className={`${field} mt-0.5 w-full`} value={query.ord} onChange={(e) => set("ord", e.target.value as RosterQuery["ord"])}>
                    {ORDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="col-span-2 flex items-center gap-2 text-xs font-semibold text-mute sm:col-span-4 lg:hidden">
                  <input type="checkbox" checked={query.shiny} onChange={(e) => set("shiny", e.target.checked)} className="size-4 accent-[#b66bff]" /> Só shiny
                </label>
              </div>
              <div className="tnum flex items-center justify-between text-[11px] text-mute lg:hidden" aria-live="polite">
                <span>{page ? `${nf.format(page.total)} de ${nf.format(page.owned)} Pokémon` : "Carregando…"}</span>
                <span className={full ? "font-bold text-poke-gold" : ""}>{full ? "Equipe completa" : `${vagas} vaga${vagas > 1 ? "s" : ""}`}</span>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-[#16100a]/60 p-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <div className="grid grid-cols-1 gap-2 min-[560px]:grid-cols-2 lg:min-[560px]:grid-cols-1 2xl:grid-cols-2">
                {items.map((r) => <RosterCard key={r.id} r={{ ...r, inTeam: ids.includes(r.id) ? true : r.inTeam }} picked={ids.includes(r.id)} onToggle={() => toggle(r.id)} onInfo={() => setSheet(r.id)} />)}
              </div>
              {loadingList && <div className="flex justify-center py-4 text-mute"><Loader2 className="size-5 animate-spin" aria-label="Carregando" /></div>}
              {!loadingList && page && items.length === 0 && <p className="py-8 text-center text-sm text-mute">Nenhum Pokémon com esses filtros.</p>}
              {page && items.length < page.total && !loadingList && <button type="button" className="btn mx-auto mt-3 flex" onClick={() => void loadList(debounced, items.length)}>Mostrar mais</button>}
            </div>
          </div>
        </div>

        <footer className="border-t border-line bg-[#1a1109] px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-4">
          {/* celular: só o essencial; o resto fica na aba Tabuleiro */}
          <div className="flex items-center gap-2 lg:hidden">
            <div className="min-w-0 flex-1 leading-tight">
              <div className="tnum truncate text-base font-extrabold text-poke-gold">⚔ {nf.format(power)}</div>
              <div className="tnum text-[11px] text-mute">{ids.length}/{TEAM_MAX} Pokémon · nível mín. {levelMin}</div>
            </div>
            {saveBtn("!min-h-11 shrink-0")}
          </div>
          {/* computador: equipe, alcances e ações completas */}
          <div className="hidden lg:block">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <span className="tnum"><span className="text-[11px] font-extrabold uppercase text-mute">Poder na luta </span><b className="text-poke-gold">⚔ {nf.format(power)}</b></span>
              {rangeChips}
              <span className="tnum text-xs text-mute">{ids.length}/{TEAM_MAX} no tabuleiro</span>
              {typeChips}
            </div>
            <div className="flex flex-wrap items-stretch gap-2">
              <div className="flex min-w-[16rem] flex-1">{teamStrip}</div>
              <div className="ml-auto flex flex-wrap items-center gap-2">{tools}{saveBtn()}</div>
            </div>
          </div>
          {errBox}
          <p className="mt-1.5 hidden text-[11px] text-mute lg:block">Arraste um Pokémon da lista para uma casa, ou toque nele e depois na casa. Quem ficar sem casa é posicionado pelo alcance. Nível mínimo: {levelMin}. A equipe é fechada antes da fila e não muda durante a partida.</p>
        </footer>
      </motion.div>
      <AnimatePresence>{sheet != null && <PokemonSheet source={{ kind: "own", account, id: sheet }} onClose={() => setSheet(null)} />}</AnimatePresence>
    </motion.div>
  );
}

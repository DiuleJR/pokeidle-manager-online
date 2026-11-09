import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Crosshair, Loader2, Lock, Search, Swords, Timer, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PokemonSprite } from "@/components/Sprites";
import { Reveal } from "@/components/ui";
import { actions, useCreatures, useHuntCatalog, type Creature, type Hunt } from "@/lib/actions";
import { useAccountIds, useAccountsMap } from "@/lib/telemetry";
import { effectiveness, matchup, TYPE_COLOR, TYPES } from "@/lib/typeChart";
import { fmtInt } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;
const REGION_ORDER = ["kanto", "outland", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const rank = (id: string) => {
  const i = REGION_ORDER.indexOf(id);
  return i < 0 ? 99 : i;
};

type Mode = "own" | "weak" | "strong";
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "own", label: "Do tipo", hint: "Áreas com Pokémon desses tipos" },
  { id: "weak", label: "Fraco contra", hint: "Áreas cujos Pokémon são fracos (×2 ou mais) a esses tipos" },
  { id: "strong", label: "Forte contra", hint: "Áreas cujos Pokémon resistem (×0,5 ou menos) a esses tipos" },
];

function TypeChip({ type, mult }: { type: string; mult?: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase leading-none tracking-wide text-white/95"
      style={{ background: TYPE_COLOR[type] ?? "#555" }}
    >
      {type}
      {mult !== undefined && <span className="tnum font-bold opacity-90">×{mult === 0 ? "0" : mult.toString().replace(".", ",")}</span>}
    </span>
  );
}

const typesOf = (h: Hunt, creatures: Record<string, Creature> | null) => {
  const set = new Set<string>();
  for (const e of h.especies) for (const t of creatures?.[String(e.pokeId)]?.t ?? []) set.add(t);
  return [...set];
};

function matches(h: Hunt, creatures: Record<string, Creature> | null, q: string, types: string[], mode: Mode) {
  if (q) {
    const hay = [h.nome, ...h.especies.map((e) => e.nome)].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (!types.length) return true;
  if (!creatures) return true; // ainda carregando: não esconde nada
  return h.especies.some((e) => {
    const t = creatures[String(e.pokeId)]?.t ?? [];
    if (mode === "own") return t.some((x) => types.includes(x));
    if (mode === "weak") return types.some((a) => effectiveness(a, t) > 1);
    return types.some((a) => effectiveness(a, t) < 1);
  });
}

type Status = { slug: string; state: "sending" | "ok" | "ignored" | "err" | "queued"; text?: string } | null;

/** Segundos restantes arredondados para cima ("3 s"). */
const secs = (ms: number) => `${Math.max(1, Math.ceil(ms / 1000))} s`;

const HuntRow = memo(function HuntRow({
  h,
  creatures,
  level,
  current,
  queued,
  focused,
  canHunt,
  busy,
  onFocus,
  onHunt,
}: {
  h: Hunt;
  creatures: Record<string, Creature> | null;
  level: number;
  current: boolean;
  queued: boolean;
  focused: boolean;
  canHunt: boolean;
  busy: boolean;
  onFocus: (slug: string) => void;
  onHunt: (h: Hunt) => void;
}) {
  const first = h.especies[0];
  const lk = (first && creatures?.[String(first.pokeId)]?.lk) ?? h.looktype;
  const types = typesOf(h, creatures);
  const tooHigh = h.nivel > level;
  return (
    <div
      onPointerEnter={(e) => e.pointerType === "mouse" && onFocus(h.slug)}
      onClick={() => onFocus(h.slug)}
      className={`tile flex items-center gap-2.5 px-2 py-1.5 transition-colors duration-150 sm:gap-3 sm:px-3 ${
        current ? "!border-poke-green/70" : focused ? "!border-edge" : ""
      }`}
    >
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-edge/70 sm:size-12"
        style={{ background: "radial-gradient(circle at 50% 35%, #4a3519, #1a120a 75%)" }}
      >
        <PokemonSprite looktype={lk} size={40} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-[15px] font-bold leading-tight sm:text-base">{h.nome}</span>
          <span className={`tnum rounded border px-1.5 py-0.5 text-[10px] font-extrabold leading-none ${tooHigh ? "border-poke-red/60 text-poke-red" : "border-line text-mute"}`}>
            Nv {fmtInt(h.nivel)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {types.length ? types.map((t) => <TypeChip key={t} type={t} />) : <span className="text-xs text-mute">{h.especies.length} espécie(s)</span>}
        </div>
      </div>
      {current ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-poke-green/60 bg-[#16301c] px-2.5 py-1.5 text-xs font-extrabold uppercase tracking-wide text-poke-green">
          <Check className="size-3.5" aria-hidden /> Caçando
        </span>
      ) : queued ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-[#3a2a12] px-2.5 py-1.5 text-xs font-extrabold uppercase tracking-wide text-poke-gold">
          <Timer className="size-3.5" aria-hidden /> Na fila
        </span>
      ) : (
        <button
          type="button"
          className="btn shrink-0"
          data-active="true"
          disabled={!canHunt || busy}
          title={canHunt ? `Mandar a conta caçar em ${h.nome}` : "A conta precisa estar online"}
          onClick={(e) => {
            e.stopPropagation();
            onHunt(h);
          }}
        >
          <Crosshair className="size-4" aria-hidden /> Caçar
        </button>
      )}
    </div>
  );
});

/** Painel de análise da área: espécies, fraquezas, resistências e drops (dados públicos do jogo). */
function Analyser({ hunt, creatures }: { hunt: Hunt | null; creatures: Record<string, Creature> | null }) {
  if (!hunt) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-mute">
        <Swords className="size-7 text-edge/70" aria-hidden />
        Passe o mouse (ou toque) numa área da lista para ver as fraquezas e os drops.
      </div>
    );
  }
  const species = [...hunt.especies].sort((a, b) => b.pontos - a.pontos);
  const drops = new Set<string>();
  for (const e of species) for (const d of creatures?.[String(e.pokeId)]?.l ?? []) drops.add(d);
  return (
    <motion.div key={hunt.slug} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE }} className="space-y-3">
      <div>
        <h3 className="text-lg font-extrabold leading-tight">{hunt.nome}</h3>
        <p className="text-xs text-mute">
          {cap(hunt.area)} · Nv <span className="tnum">{fmtInt(hunt.nivel)}</span> · {species.length} espécie(s)
        </p>
      </div>
      {!creatures && <p className="text-sm text-mute">Carregando dados do jogo…</p>}
      {species.map((e) => {
        const c = creatures?.[String(e.pokeId)];
        const m = c ? matchup(c.t) : null;
        return (
          <section key={e.pokeId} className="border-t border-line pt-2">
            <div className="flex items-center gap-2">
              <PokemonSprite looktype={c?.lk} size={36} />
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{e.nome}</div>
                <div className="mt-0.5 flex gap-1">{c?.t.map((t) => <TypeChip key={t} type={t} />)}</div>
              </div>
            </div>
            {m && (
              <dl className="mt-2 space-y-1.5 text-xs">
                <div>
                  <dt className="mb-1 font-bold uppercase tracking-wide text-mute">Fraco a</dt>
                  <dd className="flex flex-wrap gap-1">{m.weak.length ? m.weak.map((w) => <TypeChip key={w.type} type={w.type} mult={w.mult} />) : <span className="text-mute">—</span>}</dd>
                </div>
                <div>
                  <dt className="mb-1 font-bold uppercase tracking-wide text-mute">Resiste a</dt>
                  <dd className="flex flex-wrap gap-1">{m.resist.length ? m.resist.map((w) => <TypeChip key={w.type} type={w.type} mult={w.mult} />) : <span className="text-mute">—</span>}</dd>
                </div>
              </dl>
            )}
          </section>
        );
      })}
      {drops.size > 0 && (
        <section className="border-t border-line pt-2">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-mute">Pode dropar</div>
          <ul className="flex flex-wrap gap-1">
            {[...drops].slice(0, 24).map((d) => (
              <li key={d} className="rounded border border-line bg-void px-1.5 py-0.5 text-xs">
                {d}
              </li>
            ))}
          </ul>
        </section>
      )}
    </motion.div>
  );
}

/** Aba Mapa: escolhe uma conta, navega pelas áreas do jogo e manda a conta caçar em uma delas. */
export function MapaView() {
  const ids = useAccountIds();
  const accounts = useAccountsMap();
  const [picked, setPicked] = useState("");
  const selected = ids.includes(picked) ? picked : (ids.find((i) => accounts[i]?.status === "online") ?? ids[0] ?? "");
  const acc = accounts[selected];
  const { data: cat, error } = useHuntCatalog(selected || null);
  const creatures = useCreatures();

  const [area, setArea] = useState("");
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("own");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const level = acc?.level ?? cat?.level ?? 0;
  const currentSlug = acc?.hunt?.slug ?? cat?.current ?? null;
  const online = acc?.status === "online";

  // Regiões na ordem do jogo, com o menor nível de cada uma (trava visual).
  const regions = useMemo(() => {
    const min = new Map<string, number>();
    for (const h of cat?.hunts ?? []) min.set(h.area, Math.min(min.get(h.area) ?? Infinity, h.nivel));
    return [...min.entries()]
      .map(([id, nivel]) => ({ id, nivel }))
      .sort((a, b) => rank(a.id) - rank(b.id) || a.nivel - b.nivel);
  }, [cat]);

  // Região inicial: a da hunt atual da conta (ou a primeira).
  const currentArea = cat?.hunts.find((h) => h.slug === currentSlug)?.area;
  useEffect(() => {
    if (!regions.length) return;
    if (!area || !regions.some((r) => r.id === area)) setArea(currentArea && regions.some((r) => r.id === currentArea) ? currentArea : regions[0].id);
  }, [regions, area, currentArea]);

  const q = query.trim().toLowerCase();
  const list = useMemo(
    () =>
      (cat?.hunts ?? [])
        .filter((h) => h.area === area && (!onlyOpen || h.nivel <= level) && matches(h, creatures, q, types, mode))
        .sort((a, b) => a.nivel - b.nivel || a.nome.localeCompare(b.nome)),
    [cat, area, onlyOpen, level, creatures, q, types, mode],
  );
  const focused = useMemo(() => cat?.hunts.find((h) => h.slug === (focus ?? currentSlug)) ?? null, [cat, focus, currentSlug]);

  const hunt = useCallback(
    async (h: Hunt) => {
      if (!selected) return;
      setStatus({ slug: h.slug, state: "sending" });
      try {
        const r = await actions.selectHunt(selected, h.slug);
        if (r.queued) {
          setStatus({ slug: h.slug, state: "queued" });
          return;
        }
        setStatus(
          r.confirmed
            ? { slug: h.slug, state: "ok", text: `${acc?.nick ?? "A conta"} agora caça em ${h.nome}.` }
            : { slug: h.slug, state: "ignored", text: "O jogo não aceitou a troca. A conta pode estar em combate (espere alguns segundos) ou sem o nível da área." },
        );
      } catch (e) {
        setStatus({ slug: h.slug, state: "err", text: e instanceof Error ? e.message : "Não foi possível trocar de hunt." });
      }
    },
    [selected, acc?.nick],
  );
  useEffect(() => {
    if (status?.state !== "ok") return;
    const t = setTimeout(() => setStatus(null), 5000);
    return () => clearTimeout(t);
  }, [status]);

  // Fila: a hunt que espera a trava de combate acabar (vem do servidor, então sobrevive a trocar de aba).
  const pendingSlug = acc?.huntPending?.slug ?? (status?.state === "queued" ? status.slug : null);
  const pendingName = acc?.huntPending?.name ?? cat?.hunts.find((h) => h.slug === pendingSlug)?.nome ?? "";
  const seenPending = useRef(false);
  useEffect(() => {
    if (status?.state !== "queued") {
      seenPending.current = false;
      return;
    }
    if (acc?.huntPending?.slug === status.slug) {
      seenPending.current = true;
    } else if (acc?.hunt?.slug === status.slug) {
      setStatus({ slug: status.slug, state: "ok", text: `${acc.nick} saiu do combate e agora caça em ${pendingName || "a nova área"}.` });
    } else if (seenPending.current) {
      setStatus({ slug: status.slug, state: "ignored", text: "O jogo não aceitou a troca depois de várias tentativas. Peça de novo." });
    }
  }, [status, acc?.huntPending?.slug, acc?.hunt?.slug, acc?.nick, pendingName]);

  const cancelQueue = useCallback(async () => {
    if (!selected) return;
    setStatus(null);
    try {
      await actions.cancelHuntQueue(selected);
    } catch (e) {
      setStatus({ slug: "", state: "err", text: e instanceof Error ? e.message : "Não foi possível cancelar." });
    }
  }, [selected]);

  const toggleType = (t: string) => setTypes((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  if (!ids.length) return <p className="card p-10 text-center text-mute">Aguardando dados da VPS…</p>;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Conta que vai caçar */}
      <Reveal index={0}>
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Conta que vai caçar">
          <span className="label mr-1">Conta</span>
          {ids.map((id) => {
            const a = accounts[id];
            const on = id === selected;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                className="btn"
                data-active={on}
                onClick={() => {
                  setPicked(id);
                  setStatus(null);
                  setFocus(null);
                }}
              >
                <span className={`size-2 rounded-full ${a?.status === "online" ? "bg-poke-green" : "bg-mute"}`} aria-hidden />
                {a?.nick ?? id}
              </button>
            );
          })}
          {acc && (
            <span className="ml-auto text-sm text-mute">
              Caçando em <b className="font-semibold text-fg">{acc.huntName ?? cat?.hunts.find((h) => h.slug === currentSlug)?.nome ?? "—"}</b>
            </span>
          )}
        </div>
      </Reveal>

      {!online && acc && (
        <p className="rounded-lg border border-[#7a5a1c] bg-[#33260e] px-3 py-2 text-sm text-poke-gold" role="status">
          {acc.nick} não está online agora: dá para ver o mapa, mas só dá para trocar de hunt com a conta conectada.
        </p>
      )}

      {/* Regiões */}
      <Reveal index={1}>
        <div className="-mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-1" role="tablist" aria-label="Região">
          {regions.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={area === r.id}
              className="btn shrink-0 flex-col !gap-0 !py-1.5"
              data-active={area === r.id}
              onClick={() => setArea(r.id)}
            >
              <span className="flex items-center gap-1">
                {r.nivel > level && <Lock className="size-3 opacity-70" aria-hidden />}
                {cap(r.id)}
              </span>
              <span className="tnum text-[10px] font-semibold opacity-70">Nv {fmtInt(r.nivel)}</span>
            </button>
          ))}
        </div>
      </Reveal>

      {/* Filtros */}
      <Reveal index={2}>
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mute" aria-hidden />
              <input className="field w-full !pl-9" type="search" placeholder="Buscar área ou Pokémon…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar área ou Pokémon" />
            </label>
            <div className="flex gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
            <button type="button" className="btn" data-active={types.length > 0} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
              Tipo{types.length ? `: ${types.length}` : ""}
              <ChevronDown className={`size-4 transition-transform duration-200 ${filtersOpen ? "rotate-180" : ""}`} aria-hidden />
            </button>
            <button type="button" className="btn" data-active={onlyOpen} aria-pressed={onlyOpen} onClick={() => setOnlyOpen((v) => !v)} title="Só as áreas que o nível da conta já alcança">
              Liberadas
            </button>
            </div>
            <span className="text-xs text-mute sm:ml-auto" aria-live="polite">
              {fmtInt(list.length)} áreas em {cap(area || "—")}
            </span>
          </div>
          <AnimatePresence initial={false}>
            {filtersOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: EASE }}
                className="overflow-hidden"
              >
                <div className="tile space-y-2.5 p-3">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipos">
                    {TYPES.map((t) => {
                      const on = types.includes(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleType(t)}
                          className={`rounded px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide transition-opacity duration-150 ${on ? "text-white" : "text-white/80 opacity-45 hover:opacity-80"}`}
                          style={{ background: TYPE_COLOR[t] }}
                        >
                          {t}
                        </button>
                      );
                    })}
                    {types.length > 0 && (
                      <button type="button" className="btn !px-2 !py-1 text-xs" onClick={() => setTypes([])}>
                        Limpar
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Como usar os tipos">
                    {MODES.map((m) => (
                      <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} title={m.hint} className="btn" data-active={mode === m.id} onClick={() => setMode(m.id)}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Reveal>

      <div aria-live="polite" className="min-h-5 space-y-1.5">
        <AnimatePresence initial={false}>
          {pendingSlug && (
            <motion.div
              key="queue"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-edge bg-[#3a2a12] px-3 py-2 text-sm text-poke-gold">
                <Timer className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  {acc?.nick ?? "A conta"} está em combate. Assim que puder sair, troca para <b>{pendingName || pendingSlug}</b>
                  {acc && acc.combatLockMs ? <> (faltam ~<span className="tnum">{secs(acc.combatLockMs)}</span>)</> : null}.
                </span>
                <button type="button" className="btn !py-1" onClick={() => void cancelQueue()}>
                  <X className="size-4" aria-hidden /> Cancelar
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence mode="wait">
          {status && status.state !== "queued" && (
            <motion.p
              key={status.state + status.slug}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex items-center gap-2 text-sm ${status.state === "ok" ? "text-poke-green" : status.state === "sending" ? "text-mute" : status.state === "ignored" ? "text-poke-gold" : "text-poke-red"}`}
            >
              {status.state === "sending" && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {status.state === "sending" ? "Enviando a troca para o jogo…" : status.text}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {error && !cat?.hunts.length && <p className="card p-6 text-center text-poke-red">Não foi possível carregar o mapa ({error}).</p>}
      {!cat && !error && <p className="card p-10 text-center text-mute">Carregando o mapa…</p>}
      {cat && cat.hunts.length === 0 && <p className="card p-10 text-center text-mute">O jogo ainda não enviou as áreas. Aguarde a conta terminar de conectar.</p>}

      {cat && cat.hunts.length > 0 && (
        <Reveal index={3}>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <ul key={area} className="space-y-1.5 lg:max-h-[calc(100vh-22rem)] lg:overflow-y-auto lg:pr-1">
              {list.length === 0 && <li className="card p-8 text-center text-sm text-mute">Nenhuma área com esses filtros.</li>}
              {list.map((h, i) => {
                const row = (
                  <HuntRow
                    h={h}
                    creatures={creatures}
                    level={level}
                    current={h.slug === currentSlug}
                    queued={h.slug === pendingSlug}
                    focused={h.slug === focused?.slug}
                    canHunt={online}
                    busy={status?.state === "sending"}
                    onFocus={setFocus}
                    onHunt={hunt}
                  />
                );
                // Só as primeiras linhas animam a entrada (listas de 100+ áreas não ficam pesadas).
                return i < 14 ? (
                  <Reveal as="li" key={h.slug} index={i} step={0.03} max={14}>
                    {row}
                  </Reveal>
                ) : (
                  <li key={h.slug}>{row}</li>
                );
              })}
            </ul>
            <aside className="card p-3 lg:sticky lg:top-16 lg:max-h-[calc(100vh-22rem)] lg:overflow-y-auto" aria-label="Análise da área">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-mute">Análise da área</div>
              <Analyser hunt={focused} creatures={creatures} />
            </aside>
          </div>
        </Reveal>
      )}
    </div>
  );
}

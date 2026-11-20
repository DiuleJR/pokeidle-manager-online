import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Loader2, Pencil, Shield, Swords, Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { PokemonSheet } from "@/components/PokemonSheet";
import { PvpRewardClocks } from "@/components/PvpRewards";
import { PvpTeamEditor } from "@/components/PvpTeamEditor";
import { PokemonSprite } from "@/components/Sprites";
import { Reveal } from "@/components/ui";
import {
  clockMs,
  PLACEMENT_MATCHES,
  pvpApi,
  rankIcon,
  rankLabel,
  TIER_COLOR,
  TIER_NAME,
  usePvp,
  type LadderPage,
  type PvpAccount,
  type PvpMatch,
} from "@/lib/pvp";
import { serverNow } from "@/lib/telemetry";

const EASE = [0.22, 1, 0.36, 1] as const;
const pt = new Intl.NumberFormat("pt-BR");
const VIOLET = "#b66bff";

/** Relógio de 1 s para as contagens (tempo na fila, espera entre partidas). */
function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const i = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [active]);
}

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-40"
      style={{ borderColor: on ? VIOLET : "#3b2b17", background: on ? "rgba(182,107,255,.35)" : "#16100a" }}
    >
      <span
        className="absolute left-0.5 top-0.5 size-4 rounded-full transition-transform duration-200"
        style={{ background: on ? VIOLET : "#b39a6e", transform: on ? "translateX(20px)" : "none" }}
      />
    </button>
  );
}

function Emblem({ tier, size }: { tier: string; size: number }) {
  const [broken, setBroken] = useState(false);
  const color = TIER_COLOR[tier] ?? "#b39a6e";
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border-2"
      style={{ width: size, height: size, borderColor: color, background: "radial-gradient(circle at 50% 35%, rgba(255,255,255,.08), rgba(0,0,0,.35))", boxShadow: `0 0 18px -6px ${color}` }}
    >
      {broken ? (
        <Trophy className="size-1/2" style={{ color }} aria-hidden />
      ) : (
        <img src={rankIcon(tier)} alt={TIER_NAME[tier] ?? tier} width={size - 10} height={size - 10} className="object-contain" onError={() => setBroken(true)} />
      )}
    </span>
  );
}

function Chip({ match }: { match: PvpMatch }) {
  const up = match.delta >= 0;
  return (
    <span
      title={`${match.won ? "Vitória" : "Derrota"} contra ${match.opponent}`}
      className="tnum inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-bold"
      style={{ borderColor: match.won ? "#2f6b3a" : "#7a3030", color: match.won ? "#6fd47c" : "#ef6b5b", background: match.won ? "#142b19" : "#2a1212" }}
    >
      {match.won ? "V" : "D"}
      <span className="font-semibold opacity-80">{up ? "+" : ""}{match.delta}</span>
    </span>
  );
}

function StatusLine({ a }: { a: PvpAccount }) {
  const queued = a.queue.on;
  useTick(queued || a.queue.waitMs > 0);
  if (!a.online) return <span className="text-xs font-semibold text-mute">Offline</span>;
  if (queued) {
    const ms = a.queue.since ? Math.max(0, serverNow() - a.queue.since) : 0;
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: VIOLET }}>
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Buscando partida <span className="tnum">{clockMs(ms)}</span>
        {a.queue.size > 0 && <span className="font-medium text-mute">· {pt.format(a.queue.size)} na fila</span>}
      </span>
    );
  }
  if (a.blockerText && a.blocker !== "offline") return <span className="text-xs font-semibold text-poke-red">{a.blockerText}</span>;
  if (a.queue.waitMs > 0) return <span className="tnum text-xs font-semibold text-mute">Próxima partida em {Math.ceil(a.queue.waitMs / 1000)} s</span>;
  if (a.auto) return <span className="text-xs font-semibold text-poke-green">Pronta, entra na fila sozinha</span>;
  return <span className="text-xs font-semibold text-mute">Parada</span>;
}

function RankBlock({ a }: { a: PvpAccount }) {
  const r = a.rank;
  if (!r) return <div className="tile p-3 text-sm text-mute">Carregando o rank…</div>;
  const placing = r.partidas < PLACEMENT_MATCHES;
  const total = r.vitorias + r.derrotas;
  const rate = total ? Math.round((r.vitorias / total) * 100) : 0;
  const color = TIER_COLOR[r.tierId] ?? "#b39a6e";
  const pct = placing ? (r.partidas / PLACEMENT_MATCHES) * 100 : r.progresso == null ? 100 : Math.round(r.progresso * 100);
  return (
    <div className="flex items-center gap-3">
      <Emblem tier={placing ? "bronze" : r.tierId} size={64} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-extrabold leading-tight" style={{ color: placing ? undefined : color }}>
          {placing ? "Não classificado" : rankLabel(r)}
        </div>
        <div className="tnum text-sm text-mute">
          {placing ? `Posicionamento ${r.partidas}/${PLACEMENT_MATCHES}` : <><b className="text-fg">{pt.format(r.pontos)}</b> PR{a.position ? ` · #${pt.format(a.position)}` : ""}</>}
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-tile ring-1 ring-line" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso na divisão">
          <motion.div className="h-full rounded-full" style={{ background: placing ? VIOLET : color }} initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.5, ease: EASE }} />
        </div>
        <div className="tnum mt-1 flex flex-wrap items-center gap-x-3 text-xs text-mute">
          <span><b className="text-poke-green">{pt.format(r.vitorias)}V</b> / <b className="text-poke-red">{pt.format(r.derrotas)}D</b></span>
          {total > 0 && <span>{rate}%</span>}
          {!placing && r.ate != null && r.ate > r.pontos && <span>faltam {pt.format(r.ate - r.pontos)} PR</span>}
          {(r.escudo ?? 0) > 0 && <span className="inline-flex items-center gap-0.5" title="Escudo: a próxima derrota não derruba de faixa"><Shield className="size-3" aria-hidden /> escudo</span>}
        </div>
      </div>
    </div>
  );
}

function TeamStrip({ a, onEdit, onSheet }: { a: PvpAccount; onEdit: () => void; onSheet: (id: number) => void }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-extrabold uppercase tracking-wide text-mute">Equipe de PVP</span>
        <button type="button" className="btn !px-2 !py-1 text-xs" onClick={onEdit} disabled={!a.online} title={a.online ? "Montar a equipe no tabuleiro" : "A conta precisa estar online"}>
          <Pencil className="size-3.5" aria-hidden /> {a.team.length ? "Editar equipe" : "Montar equipe"}
        </button>
      </div>
      {!a.team.length ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-mute">Sem equipe de PVP. Monte até 5 Pokémon no tabuleiro para poder entrar na fila.</p>
      ) : (
        <ul className="grid grid-cols-5 gap-1.5 sm:flex sm:flex-wrap" aria-label="Equipe de PVP">
          {a.team.map((p) => (
            <li key={p.id} className="min-w-0 sm:w-[3.9rem]">
              <button
                type="button"
                disabled={p.missing}
                onClick={() => onSheet(p.id)}
                aria-label={p.missing ? "Pokémon que saiu da conta" : `Abrir a ficha de ${p.name}`}
                title={p.missing ? "Pokémon que saiu da conta" : `${p.name} Nv ${p.level}${p.shiny ? " (shiny)" : ""}: ver ficha`}
                className="tile flex w-full min-w-0 cursor-pointer flex-col items-center py-1 transition-colors hover:border-[#b66bff] hover:bg-[#2a1b3a] disabled:cursor-default disabled:hover:border-line disabled:hover:bg-transparent"
              >
                {p.missing ? <span className="flex size-10 items-center justify-center text-mute">?</span> : <PokemonSprite looktype={p.looktype} size={40} />}
                <span className="tnum text-[10px] font-bold leading-none text-mute">{p.missing ? "—" : `Nv ${p.level}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountPvp({ a, index, onChanged }: { a: PvpAccount; index: number; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState<number | null>(null);
  const recent = useMemo(() => (a.session.matches.length ? a.session.matches : a.history.slice(0, 8)), [a]);
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setErr("");
      try {
        await fn();
        onChanged();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Falhou");
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );
  const inQueue = a.queue.on;
  const canQueue = a.online && !a.blocker;
  return (
    <Reveal as="section" index={index} className="card flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-base font-extrabold sm:text-lg">{a.nick}</h3>
          <span className="tnum shrink-0 text-xs text-mute">Nv {pt.format(a.level)}</span>
          {a.vip && <span className="shrink-0 rounded bg-poke-gold/15 px-1.5 py-0.5 text-[10px] font-extrabold text-poke-gold">VIP</span>}
        </div>
        <StatusLine a={a} />
      </header>

      <RankBlock a={a} />
      <TeamStrip a={a} onEdit={() => setEditing(true)} onSheet={setSheet} />

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          className="btn"
          disabled={busy || (!inQueue && !canQueue)}
          onClick={() => run(() => pvpApi.queue(a.id, inQueue ? "leave" : "enter"))}
          style={inQueue ? undefined : canQueue ? { borderColor: VIOLET, color: VIOLET } : undefined}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Swords className="size-4" aria-hidden />}
          {inQueue ? "Cancelar busca" : "Procurar partida"}
        </button>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <span>Fila automática</span>
          <Switch on={a.auto} label={`Fila automática de ${a.nick}`} disabled={busy} onChange={(v) => void run(() => pvpApi.auto(a.id, v))} />
        </label>
      </div>
      {a.nativeAuto && <p className="text-xs text-mute">A fila automática do próprio jogo (VIP) está ligada: ela faz o serviço.</p>}
      {(err || a.refusal) && <p className="rounded-md bg-poke-red/10 px-2 py-1 text-xs text-poke-red" role="alert">{err || a.refusal?.msg}</p>}

      {recent.length > 0 && (
        <div className="min-w-0 border-t border-line pt-2.5">
          <div className="mb-1.5 flex items-center justify-between text-xs text-mute">
            <span>{a.session.matches.length ? "Partidas desta sessão" : "Últimas partidas"}</span>
            {a.session.matches.length > 0 && (
              <span className="tnum font-semibold">
                <b className="text-poke-green">{a.session.wins}V</b> / <b className="text-poke-red">{a.session.losses}D</b> · {a.session.delta >= 0 ? "+" : ""}{a.session.delta} PR
              </span>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto overscroll-x-contain pb-2 [&>*]:shrink-0" tabIndex={0} role="group" aria-label="Histórico de partidas, role para o lado">
            {recent.slice(0, 60).map((m, i) => (
              <Chip key={`${m.id}-${i}`} match={m} />
            ))}
          </div>
        </div>
      )}
      {createPortal(
        <AnimatePresence>
          {editing && <PvpTeamEditor account={a.id} nick={a.nick} levelMin={a.levelMin} onClose={() => setEditing(false)} onSaved={onChanged} />}
          {sheet != null && <PokemonSheet source={{ kind: "own", account: a.id, id: sheet }} onClose={() => setSheet(null)} />}
        </AnimatePresence>,
        document.body,
      )}
    </Reveal>
  );
}

// ------------------------------------------------------------------ tabela
function Ladder({ mine }: { mine: Set<string> }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LadderPage | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: number, attempt = 0): Promise<void> => {
    setLoading(true);
    setErr("");
    try {
      setData(await pvpApi.ladder(p));
      setLoading(false);
    } catch (e) {
      // O painel pode ter acabado de subir ou o jogo demorou a responder: tenta mais duas vezes antes de mostrar o erro.
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2500));
        return load(p, attempt + 1);
      }
      setErr(e instanceof Error ? e.message : "Falha ao ler a tabela");
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(page);
  }, [page, load]);

  const pages = data?.pages ?? 10;
  return (
    <section className="card p-3 sm:p-4" aria-label="Tabela do PVP">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-extrabold sm:text-lg">
          <Trophy className="size-5" style={{ color: VIOLET }} aria-hidden /> Tabela · Top 1.000
        </h3>
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} aria-label="Página anterior">
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="tnum min-w-20 text-center text-sm font-semibold text-mute">
            {loading && !data ? "…" : `${(page - 1) * 100 + 1}º ao ${page * 100}º`}
          </span>
          <button type="button" className="btn" disabled={page >= pages || loading} onClick={() => setPage(page + 1)} aria-label="Próxima página">
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </header>
      {err && <p className="mb-2 rounded-md bg-poke-red/10 px-2 py-1 text-xs text-poke-red" role="alert">{err}</p>}
      <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-tile text-left text-xs text-mute">
            <tr>
              <th className="px-2 py-1.5 font-semibold">#</th>
              <th className="px-2 py-1.5 font-semibold">Jogador</th>
              <th className="hidden px-2 py-1.5 font-semibold sm:table-cell">Faixa</th>
              <th className="px-2 py-1.5 text-right font-semibold">PR</th>
              <th className="hidden px-2 py-1.5 text-right font-semibold sm:table-cell">V / D</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => {
              const me = mine.has(r.nick.toLowerCase());
              return (
                <tr key={r.pos} className={`border-t border-line ${me ? "bg-[#2e1f45]" : ""}`}>
                  <td className="tnum px-2 py-1 text-mute">{r.pos}</td>
                  <td className="px-2 py-1 font-semibold" style={me ? { color: VIOLET } : undefined}>
                    {r.nick}
                    {me && <span className="ml-1.5 text-[10px] font-extrabold">VOCÊ</span>}
                  </td>
                  <td className="hidden px-2 py-1 sm:table-cell" style={{ color: TIER_COLOR[r.tier] }}>{TIER_NAME[r.tier] ?? r.tier} {r.division}</td>
                  <td className="tnum px-2 py-1 text-right font-bold text-poke-gold">{pt.format(r.points)}</td>
                  <td className="tnum hidden px-2 py-1 text-right text-mute sm:table-cell">{pt.format(r.wins)} / {pt.format(r.losses)}</td>
                </tr>
              );
            })}
            {!data && !err && (
              <tr><td colSpan={5} className="px-2 py-6 text-center text-mute">Carregando a tabela…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// -------------------------------------------------------------------- aba
export function PvpView() {
  const { data, error, refresh } = usePvp();
  const accounts = data?.accounts ?? [];
  const [bulkBusy, setBulkBusy] = useState(false);
  const mine = useMemo(() => new Set(accounts.map((a) => a.nick.toLowerCase())), [accounts]);
  const autoOn = accounts.filter((a) => a.auto).length;
  const queued = accounts.filter((a) => a.queue.on).length;
  const wins = accounts.reduce((n, a) => n + a.session.wins, 0);
  const losses = accounts.reduce((n, a) => n + a.session.losses, 0);
  const delta = accounts.reduce((n, a) => n + a.session.delta, 0);
  const allOn = accounts.length > 0 && autoOn === accounts.length;

  const bulk = async (on: boolean) => {
    setBulkBusy(true);
    try {
      await pvpApi.autoAll(on);
      await refresh();
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <section className="card flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-3 sm:p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-extrabold sm:text-lg">
            <Swords className="size-5" style={{ color: VIOLET }} aria-hidden /> PVP ranqueado
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="tnum text-sm text-mute" aria-live="polite">
            <b className="text-fg">{queued}</b> na fila · <b className="text-poke-green">{wins}V</b> / <b className="text-poke-red">{losses}D</b> · {delta >= 0 ? "+" : ""}{delta} PR
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <span>Todas as contas</span>
            <Switch on={allOn} label="Fila automática em todas as contas" disabled={bulkBusy || accounts.length === 0} onChange={(v) => void bulk(v)} />
          </label>
        </div>
      </section>

      <PvpRewardClocks accounts={accounts} />

      {error && !data && <p className="rounded-md bg-poke-red/10 px-3 py-2 text-sm text-poke-red" role="alert">{error}</p>}
      {!data && !error && <p className="py-10 text-center text-mute">Carregando o PVP…</p>}
      {data && accounts.length === 0 && <p className="py-10 text-center text-mute">Nenhuma conta conectada.</p>}

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        {accounts.map((a, i) => (
          <AccountPvp key={a.id} a={a} index={i} onChanged={refresh} />
        ))}
      </div>

      <Ladder mine={mine} />
    </div>
  );
}

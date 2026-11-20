import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useHistory } from "@/lib/telemetry";
import type { XpBar } from "@/lib/types";
import { fmtShort } from "@/lib/utils";

/** Treinador em dourado, Pokémon em azul: além da cor, cada barra diz de quem é. */
export const XP_TRAINER = "#f3c04a";
export const XP_MON = "#5cc8e8";
const EASE = [0.22, 1, 0.36, 1] as const;

/** Quanto da barra do nível está cheio e quanto falta. Null quando o jogo não mandou os números. */
export function xpProgress(bar?: XpBar | null) {
  if (!bar || bar.atual == null || bar.nivel == null || bar.proximo == null || bar.proximo <= bar.nivel) return null;
  const span = bar.proximo - bar.nivel;
  const done = Math.max(0, Math.min(span, bar.atual - bar.nivel));
  return { pct: done / span, falta: Math.max(0, bar.proximo - bar.atual), done, span };
}

/** "~12 min", "~3 h 20 min", "~2 dias". */
export function etaLabel(hours: number): string {
  const min = hours * 60;
  if (!Number.isFinite(min) || min <= 0) return "";
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `~${Math.round(min)} min`;
  if (min < 48 * 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `~${h} h${m ? ` ${m} min` : ""}`;
  }
  const d = Math.round(min / 1440);
  return d > 99 ? "mais de 99 dias" : `~${d} dias`;
}

const pct = (v: number) => `${v >= 0.1 || v === 0 ? Math.floor(v * 100) : (Math.floor(v * 1000) / 10).toLocaleString("pt-BR")}%`;

export interface XpTrack {
  /** Último ganho (some sozinho depois de uns segundos) ou, em `up`, a subida de nível. */
  ev: { key: number; gain: number; up: boolean } | null;
  /** XP por hora medido aqui, nos últimos ~90 s (null até haver amostra suficiente). */
  rate: number | null;
}

/** Acompanha o XP entre uma atualização e outra: avisa o ganho, a subida de nível e estima o ritmo. */
export function useXpTrack(atual: number | null | undefined, level: number | null | undefined): XpTrack {
  const [ev, setEv] = useState<XpTrack["ev"]>(null);
  const [rate, setRate] = useState<number | null>(null);
  const prev = useRef<{ x: number; lv: number | null } | null>(null);
  const samples = useRef<{ t: number; x: number }[]>([]);

  useEffect(() => {
    if (atual == null) return;
    const now = Date.now();
    const lv = level ?? null;
    const p = prev.current;
    if (p && lv === p.lv && atual > p.x) setEv({ key: now, gain: atual - p.x, up: false });
    else if (p && lv != null && p.lv != null && lv > p.lv) setEv({ key: now, gain: 0, up: true });
    const s = samples.current;
    if (p && lv !== p.lv) s.length = 0; // a barra recomeçou: a amostra antiga não vale
    prev.current = { x: atual, lv };
    s.push({ t: now, x: atual });
    while (s.length > 1 && now - s[0].t > 90_000) s.shift();
    const first = s[0];
    const last = s[s.length - 1];
    setRate(last.t - first.t >= 15_000 && last.x > first.x ? (last.x - first.x) / ((last.t - first.t) / 3_600_000) : null);
  }, [atual, level]);

  useEffect(() => {
    if (!ev) return;
    const id = window.setTimeout(() => setEv(null), 2800);
    return () => window.clearTimeout(id);
  }, [ev]);

  return { ev, rate };
}

/** "+1,2M" que sobe e some a cada ganho; "Subiu de nível" quando o nível muda. Só transform/opacity. */
export function GainChip({ ev, color }: { ev: XpTrack["ev"]; color: string }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative inline-flex h-5 items-center" aria-live="polite">
      <AnimatePresence>
        {ev && (
          <motion.span
            key={ev.key}
            initial={{ opacity: 0, y: reduce ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -6 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="tnum inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-extrabold leading-none text-void"
            style={{ background: color }}
          >
            {ev.up ? (
              <>
                <ArrowUp className="size-3" aria-hidden /> Subiu de nível!
              </>
            ) : (
              <>+{fmtShort(ev.gain)}</>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Ritmo para a conta: o do jogo (treinador) quando existe, senão o medido aqui. */
const pace = (track: XpTrack, given?: number) => (given && given > 0 ? given : track.rate);

interface MeterProps {
  who: "Treinador" | "Pokémon";
  /** Nome do Pokémon (só no Pokémon). */
  name?: string | null;
  level: number | null | undefined;
  bar: XpBar | null | undefined;
  color: string;
  /** XP por hora conhecido (treinador); se faltar, usa o medido aqui. */
  perHour?: number;
}

/** Linha com a barra do nível: quem é, nível, porcentagem, quanto falta e quando sobe. */
export function XpMeter({ who, name, level, bar, color, perHour, chunky = false }: MeterProps & { chunky?: boolean }) {
  const track = useXpTrack(bar?.atual, level);
  const p = xpProgress(bar);
  const reduce = useReducedMotion();
  const r = pace(track, perHour);
  const eta = p && r ? etaLabel(p.falta / r) : "";
  const label = who === "Pokémon" && name ? name : who;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-baseline gap-1.5 text-sm font-bold leading-tight">
          <span className="size-2 shrink-0 translate-y-[-1px] rounded-full" style={{ background: color }} aria-hidden />
          <span className="truncate">{label}</span>
          {who === "Pokémon" && name && <span className="sr-only"> (Pokémon)</span>}
          {level != null && <span className="tnum shrink-0 text-xs font-semibold text-mute">Nv. {fmtShort(level)}</span>}
        </p>
        <span className="flex shrink-0 items-center gap-2">
          <GainChip ev={track.ev} color={color} />
          {p && <span className="tnum text-sm font-extrabold" style={{ color }}>{pct(p.pct)}</span>}
        </span>
      </div>
      {p ? (
        <>
          <div
            className={`mt-1.5 overflow-hidden rounded-full bg-black/55 ${chunky ? "h-3" : "h-2"}`}
            role="progressbar"
            aria-label={`XP ${who === "Pokémon" ? "do Pokémon" : "do treinador"}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(p.pct * 100)}
          >
            <motion.div
              className="h-full w-full origin-left rounded-full"
              style={{ background: `linear-gradient(90deg, ${color}aa, ${color})` }}
              initial={false}
              animate={{ scaleX: Math.max(p.pct, 0.012) }}
              transition={reduce ? { duration: 0 } : { duration: 0.7, ease: EASE }}
            />
          </div>
          <p className="tnum mt-1 flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-mute">
            <span>
              faltam <b className="font-semibold text-fg">{fmtShort(p.falta)}</b> de XP
            </span>
            {eta && <span>sobe em <b className="font-semibold text-fg">{eta}</b></span>}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-mute">Aguardando o XP desta conta…</p>
      )}
    </div>
  );
}

/** Anel de progresso com o nível no meio. Dá para ver de relance qual dos dois está mais perto de subir. */
export function XpRing({ who, name, level, bar, color, perHour }: MeterProps) {
  const track = useXpTrack(bar?.atual, level);
  const p = xpProgress(bar);
  const reduce = useReducedMotion();
  const r = pace(track, perHour);
  const eta = p && r ? etaLabel(p.falta / r) : "";
  const R = 33;
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <div className="relative size-[84px] sm:size-24">
        <svg viewBox="0 0 80 80" className="size-full -rotate-90" role="progressbar" aria-label={`XP ${who === "Pokémon" ? "do Pokémon" : "do treinador"}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p ? Math.round(p.pct * 100) : undefined}>
          <circle cx="40" cy="40" r={R} fill="none" stroke="#000" strokeOpacity=".45" strokeWidth="7" />
          <motion.circle
            cx="40"
            cy="40"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            initial={false}
            animate={{ pathLength: p ? Math.max(p.pct, 0.015) : 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.8, ease: EASE }}
            style={{ filter: `drop-shadow(0 0 4px ${color}66)` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="text-[10px] font-semibold text-mute">Nv.</span>
          <span className="tnum mt-0.5 text-lg font-extrabold sm:text-xl">{level != null ? fmtShort(level) : "—"}</span>
        </div>
        <span className="absolute -right-1 -top-1"><GainChip ev={track.ev} color={color} /></span>
      </div>
      <p className="mt-1.5 max-w-full truncate text-sm font-bold leading-tight">{who === "Pokémon" && name ? name : who}</p>
      <p className="tnum text-xs leading-tight text-mute">
        {p ? <><b className="font-extrabold" style={{ color }}>{pct(p.pct)}</b> · faltam {fmtShort(p.falta)}</> : "sem dados"}
      </p>
      {eta && <p className="tnum text-[11px] leading-tight text-mute">sobe em {eta}</p>}
    </div>
  );
}

/** Mini gráfico do XP por hora nos últimos minutos (histórico que o painel já guarda). */
export function XpSpark({ id, color = "#6fd47c" }: { id: string; color?: string }) {
  const history = useHistory();
  const { d, area } = useMemo(() => {
    const pts = history.slice(-90).map((h) => Number(h[`${id}:xp`]) || 0);
    if (pts.length < 2) return { d: "", area: "" };
    const max = Math.max(...pts, 1);
    const min = Math.min(...pts);
    const span = Math.max(max - min, max * 0.05, 1);
    const xy = pts.map((v, i) => [(i / (pts.length - 1)) * 100, 4 + (1 - (v - min) / span) * 32] as const);
    const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    return { d: line, area: `${line} L100 40 L0 40 Z` };
  }, [history, id]);
  if (!d) return <div className="h-10" aria-hidden />;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-10 w-full" aria-hidden>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

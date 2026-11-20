import { animate, AnimatePresence, motion, useAnimationControls, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { ArrowUp, Flag } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/ui";
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
    if (p && lv === p.lv && atual > p.x) {
      // Ganhos seguidos somam num chip só (em vez de empilhar um chip novo a cada abate).
      const d = atual - p.x;
      setEv((cur) => ({ key: now, gain: cur && !cur.up ? cur.gain + d : d, up: false }));
    } else if (p && lv != null && p.lv != null && lv > p.lv) setEv({ key: now, gain: 0, up: true });
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

/**
 * Chip do ganho recente. Fica um só na tela: entra subindo, o número vai contando para cima a cada novo ganho
 * e, passados uns segundos sem ganho, sai flutuando. "Subiu de nível" troca com ele em fade.
 * Só transform/opacity; o número roda por motion value (sem re-render por quadro).
 */
export function GainChip({ ev, color }: { ev: XpTrack["ev"]; color: string }) {
  const reduce = useReducedMotion();
  const shift = reduce ? 0 : 6;
  return (
    <span className="relative inline-flex h-5 items-center" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {ev && (
          <motion.span
            key={ev.up ? "up" : "gain"}
            initial={{ opacity: 0, y: shift, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -shift }}
            transition={{ duration: 0.28, ease: EASE }}
            className="tnum inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-extrabold leading-none text-void"
            style={{ background: color }}
          >
            {ev.up ? (
              <>
                <ArrowUp className="size-3" aria-hidden /> Subiu de nível!
              </>
            ) : (
              <AnimatedNumber value={ev.gain} format={(n) => `+${fmtShort(n)}`} />
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Porcentagem que conta até o novo valor e dá um pulinho a cada ganho. Ao zerar (subiu de nível) troca direto. */
function Pct({ value, pulse, className, style }: { value: number; pulse?: number; className?: string; style?: React.CSSProperties }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, pct);
  const controls = useAnimationControls();
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce || value < mv.get()) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.9, ease: EASE });
    return () => c.stop();
  }, [value, mv, reduce]);
  useEffect(() => {
    if (pulse && !reduce) void controls.start({ scale: [1, 1.14, 1], transition: { duration: 0.5, ease: EASE } });
  }, [pulse, controls, reduce]);
  return (
    <motion.span animate={controls} className={`tnum inline-block origin-right ${className ?? ""}`} style={style}>
      {text}
    </motion.span>
  );
}

/** Ritmo para a conta: o do jogo (treinador) quando existe, senão o medido aqui. */
const pace = (track: XpTrack, given?: number) => (given && given > 0 ? given : track.rate);

export interface XpWho {
  level: number | null | undefined;
  bar: XpBar | null | undefined;
  /** XP por hora conhecido (treinador); se faltar, usa o medido aqui. */
  perHour?: number;
  /** Nome do Pokémon (só no Pokémon). */
  name?: string | null;
}

/** Progresso, ritmo e previsão de um dos dois (treinador ou Pokémon). */
function useWho(w: XpWho) {
  const track = useXpTrack(w.bar?.atual, w.level);
  const p = xpProgress(w.bar);
  const r = pace(track, w.perHour);
  return { track, p, eta: p && r ? etaLabel(p.falta / r) : "" };
}
type Who = ReturnType<typeof useWho>;

/** Linha de legenda: quem é, nível, porcentagem grande, quanto falta e quando sobe. */
function Legend({ label, level, w, color }: { label: string; level: number | null | undefined; w: Who; color: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-baseline gap-1.5 text-sm font-bold leading-tight">
          <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
          <span className="truncate">{label}</span>
          {level != null && <span className="tnum shrink-0 text-xs font-semibold text-mute">Nv. {fmtShort(level)}</span>}
        </p>
        <GainChip ev={w.track.ev} color={color} />
      </div>
      {w.p ? (
        <p className="tnum mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-mute">
          <Pct value={w.p.pct} pulse={w.track.ev?.key} className="text-xl font-extrabold leading-none" style={{ color }} />
          <span>
            faltam <b className="font-semibold text-fg">{fmtShort(w.p.falta)}</b>
            {w.eta && <> · sobe em <b className="font-semibold text-fg">{w.eta}</b></>}
          </span>
        </p>
      ) : (
        <p className="mt-0.5 text-xs text-mute">Aguardando o XP desta conta…</p>
      )}
    </div>
  );
}

/** Medalhão: o Pokémon no centro; o anel de fora é o treinador (dourado), o de dentro é o Pokémon (azul). */
export function XpMedallion({ trainer, mon, sprite }: { trainer: XpWho; mon: XpWho; sprite: React.ReactNode }) {
  const t = useWho(trainer);
  const m = useWho(mon);
  const reduce = useReducedMotion();
  const ring = (r: number, w: Who, color: string) => (
    <>
      <circle cx="60" cy="60" r={r} fill="none" stroke="#000" strokeOpacity=".5" strokeWidth="8" />
      <motion.circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        initial={false}
        animate={{ pathLength: w.p ? Math.max(w.p.pct, 0.015) : 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.8, ease: EASE }}
        style={{ filter: `drop-shadow(0 0 4px ${color}66)` }}
      />
    </>
  );
  return (
    <div className="flex items-center gap-3 sm:gap-5">
      <div className="relative size-[116px] shrink-0 sm:size-[144px]">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" role="img" aria-label="Anel de fora: XP do treinador. Anel de dentro: XP do Pokémon.">
          {ring(55, t, XP_TRAINER)}
          {ring(43, m, XP_MON)}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="origin-center scale-[.8] sm:scale-[1.05]">{sprite}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <Legend label="Treinador" level={trainer.level} w={t} color={XP_TRAINER} />
        <Legend label={mon.name || "Pokémon"} level={mon.level} w={m} color={XP_MON} />
      </div>
    </div>
  );
}

/** Medidor vertical: enche de baixo para cima. */
function Gauge({ label, level, w, color }: { label: string; level: number | null | undefined; w: Who; color: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <p className="max-w-full truncate text-sm font-bold leading-tight">{label}</p>
      <p className="tnum text-xs leading-tight text-mute">{level != null ? `Nv. ${fmtShort(level)}` : "—"}</p>
      <div className="mt-1 flex h-5 items-center">
        <GainChip ev={w.track.ev} color={color} />
      </div>
      <div
        className="relative h-32 w-7 overflow-hidden rounded-full bg-black/55 ring-1 ring-white/5 sm:h-40 sm:w-8"
        role="progressbar"
        aria-label={`XP ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={w.p ? Math.round(w.p.pct * 100) : undefined}
      >
        <motion.div
          className="absolute inset-0 origin-bottom rounded-full"
          style={{ background: `linear-gradient(0deg, ${color}aa, ${color})` }}
          initial={false}
          animate={{ scaleY: w.p ? Math.max(w.p.pct, 0.02) : 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.8, ease: EASE }}
        />
        {[25, 50, 75].map((t) => (
          <span key={t} className="absolute inset-x-0 h-px bg-black/45" style={{ bottom: `${t}%` }} aria-hidden />
        ))}
      </div>
      {w.p ? (
        <>
          <p className="mt-1.5 text-lg font-extrabold leading-none"><Pct value={w.p.pct} pulse={w.track.ev?.key} style={{ color }} /></p>
          <p className="tnum mt-0.5 text-[11px] leading-tight text-mute">faltam {fmtShort(w.p.falta)}</p>
          {w.eta && <p className="tnum text-[11px] leading-tight text-mute">sobe em {w.eta}</p>}
        </>
      ) : (
        <p className="mt-1.5 text-[11px] text-mute">sem dados</p>
      )}
    </div>
  );
}

/** Versus: treinador e Pokémon como dois medidores frente a frente; no meio, o ritmo e o que couber (children). */
export function XpVersus({ trainer, mon, children }: { trainer: XpWho; mon: XpWho; children: React.ReactNode }) {
  const t = useWho(trainer);
  const m = useWho(mon);
  return (
    <div className="grid grid-cols-[minmax(0,84px)_minmax(0,1fr)_minmax(0,84px)] items-start gap-2 sm:grid-cols-[minmax(0,110px)_minmax(0,1fr)_minmax(0,110px)] sm:gap-4">
      <Gauge label="Treinador" level={trainer.level} w={t} color={XP_TRAINER} />
      <div className="min-w-0 self-center">{children}</div>
      <Gauge label={mon.name || "Pokémon"} level={mon.level} w={m} color={XP_MON} />
    </div>
  );
}

/** Uma raia da corrida: o "corredor" anda pela pista até a bandeira do próximo nível. */
function Lane({ label, level, w, color, runner }: { label: string; level: number | null | undefined; w: Who; color: string; runner: React.ReactNode }) {
  const reduce = useReducedMotion();
  const pctV = w.p ? Math.max(w.p.pct, 0.012) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-baseline gap-1.5 text-sm font-bold leading-tight">
          <span className="truncate">{label}</span>
          {level != null && <span className="tnum shrink-0 text-xs font-semibold text-mute">Nv. {fmtShort(level)}</span>}
        </p>
        <span className="flex shrink-0 items-center gap-2">
          <GainChip ev={w.track.ev} color={color} />
          {w.p && <Pct value={w.p.pct} pulse={w.track.ev?.key} className="text-base font-extrabold" style={{ color }} />}
        </span>
      </div>
      <div
        className="relative mx-5 h-11"
        role="progressbar"
        aria-label={`XP ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={w.p ? Math.round(w.p.pct * 100) : undefined}
      >
        <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full bg-black/55">
          <motion.div
            className="h-full w-full origin-left rounded-full"
            style={{ background: `linear-gradient(90deg, ${color}66, ${color})` }}
            initial={false}
            animate={{ scaleX: pctV }}
            transition={reduce ? { duration: 0 } : { duration: 0.8, ease: EASE }}
          />
        </div>
        <Flag className="absolute -right-4 top-1/2 size-4 -translate-y-1/2 text-mute" aria-hidden />
        <motion.div
          className="absolute inset-y-0 left-0 w-full"
          initial={false}
          animate={{ x: `${(pctV - 1) * 100}%` }}
          transition={reduce ? { duration: 0 } : { duration: 0.8, ease: EASE }}
        >
          <span
            className="absolute right-0 top-1/2 flex size-9 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-[#1d140b]"
            style={{ borderColor: color, boxShadow: `0 0 10px -2px ${color}99` }}
          >
            {runner}
          </span>
        </motion.div>
      </div>
      {w.p && (
        <p className="tnum -mt-0.5 text-xs text-mute">
          faltam <b className="font-semibold text-fg">{fmtShort(w.p.falta)}</b>
          {w.eta && <> · sobe em <b className="font-semibold text-fg">{w.eta}</b></>}
        </p>
      )}
    </div>
  );
}

/** Corrida: duas pistas, uma para o treinador e outra para o Pokémon; quem estiver mais à frente sobe primeiro. */
export function XpRace({ trainer, mon, trainerRunner, monRunner }: { trainer: XpWho; mon: XpWho; trainerRunner: React.ReactNode; monRunner: React.ReactNode }) {
  const t = useWho(trainer);
  const m = useWho(mon);
  return (
    <div className="space-y-2">
      <Lane label="Treinador" level={trainer.level} w={t} color={XP_TRAINER} runner={trainerRunner} />
      <Lane label={mon.name || "Pokémon"} level={mon.level} w={m} color={XP_MON} runner={monRunner} />
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

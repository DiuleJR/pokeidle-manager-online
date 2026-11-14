import { motion } from "framer-motion";
import { Check, Crown, Loader2, Lock, Timer, Trophy, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Reveal } from "@/components/ui";
import {
  clock,
  dayOf,
  dayStart,
  freeStatus,
  nextMilestone,
  PASS_ICON,
  PASSE_DIAS,
  PASSE_NIVEL_MIN,
  passApi,
  passState,
  prizeView,
  TRILHA,
  trackTotals,
  vipLeft,
  vipStatus,
  shortQty,
  type ClaimResult,
  type DayStatus,
  type PassState,
  type Prize,
  type Step,
  type Tier,
} from "@/lib/pass";
import { serverNow, useAccountIds, useAccountsMap } from "@/lib/telemetry";
import type { AccountSnapshot } from "@/lib/types";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Cor de cada raridade do dia (a borda dos cartões e o aro da medalha). */
const TIER: Record<Tier, { color: string; label: string }> = {
  comum: { color: "#7b6a56", label: "Comum" },
  incomum: { color: "#4f9a5b", label: "Incomum" },
  rara: { color: "#4a8fd0", label: "Rara" },
  mitica: { color: "#b05ad6", label: "Mítica" },
  lendaria: { color: "#f3c04a", label: "Lendária" },
};

/** Relógio de 1 segundo (hora do servidor), para as contagens regressivas. */
function useNow(): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const i = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(i);
  }, []);
  return now;
}

const pt = new Intl.NumberFormat("pt-BR");

// ------------------------------------------------------------------ prêmios
function PrizeIcon({ p, size }: { p: Prize; size: number }) {
  const v = prizeView(p);
  return (
    <span className="flex min-w-0 flex-col items-center gap-0.5" title={v.name}>
      <img src={v.icon} alt="" width={size} height={size} loading="lazy" className="object-contain [image-rendering:pixelated]" style={{ width: size, height: size }} />
      <span className="tnum text-[10px] font-bold leading-none text-mute sm:text-[11px]">{v.short}</span>
    </span>
  );
}

function DayCard({ step, track, status, locked }: { step: Step; track: "free" | "vip"; status: DayStatus; locked: boolean }) {
  const prizes = step[track];
  const tier = TIER[step.tier];
  const vip = track === "vip";
  const done = status === "pego";
  const today = status === "hoje";
  const lost = status === "perdido";
  const names = prizes.map((p) => prizeView(p).name).join(", ");
  return (
    <div
      role="group"
      aria-label={`Dia ${step.dia}, ${vip ? "premium" : "grátis"}: ${names}. ${done ? "Resgatado." : lost ? "Perdido." : today ? "Disponível hoje." : locked ? "Bloqueado." : ""}`}
      className={`relative flex min-h-[3.75rem] flex-wrap items-center justify-center gap-x-2.5 gap-y-1 rounded-lg border-2 px-1.5 py-1.5 transition-[opacity,box-shadow] duration-200 sm:px-3 ${vip ? "bg-[#231a0b]" : "bg-[#1e1623]"} ${lost ? "opacity-45 grayscale" : done ? "opacity-80" : ""}`}
      style={{
        borderColor: done ? "#3f8a4d" : tier.color,
        boxShadow: today ? `0 0 0 2px ${vip ? "#f3c04a" : "#c46ae8"}, 0 0 16px -2px ${vip ? "#f3c04a" : "#c46ae8"}` : undefined,
      }}
    >
      {prizes.map((p, i) => (
        <PrizeIcon key={i} p={p} size={28} />
      ))}
      {done && (
        <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-[#2f6b3a] bg-[#16301c] text-poke-green" aria-hidden>
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
      {lost && (
        <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-line bg-void text-mute" aria-hidden>
          <X className="size-3" strokeWidth={3} />
        </span>
      )}
      {locked && !done && !lost && (
        <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-[#7a5a1c] bg-[#33260e] text-poke-gold" aria-hidden>
          <Lock className="size-3" />
        </span>
      )}
    </div>
  );
}

function Node({ step, today }: { step: Step; today: boolean }) {
  const tier = TIER[step.tier];
  return (
    <div className="relative z-10 grid place-items-center">
      <span
        className={`grid size-9 place-items-center rounded-full border-[3px] bg-void text-sm font-extrabold tnum sm:size-10 ${today ? "text-poke-gold" : "text-fg"}`}
        style={{ borderColor: tier.color, boxShadow: today ? `0 0 0 3px rgba(243,192,74,.35), 0 0 18px -2px ${tier.color}` : undefined }}
        title={`Dia ${step.dia} · ${tier.label}${step.bau ? " · baú" : ""}`}
      >
        {step.dia}
      </span>
      {step.bau && (
        <span className="absolute -right-1.5 -top-1.5 text-xs" aria-hidden>
          {step.dia === PASSE_DIAS ? "🏆" : "⭐"}
        </span>
      )}
      {today && <span className="absolute -bottom-3.5 rounded bg-poke-gold px-1 text-[9px] font-black leading-[14px] text-void">HOJE</span>}
    </div>
  );
}

function Trail({ st }: { st: PassState }) {
  return (
    <div>
      {/* Cabeçalho das colunas */}
      <div className="grid grid-cols-[minmax(0,1fr)_2.25rem_minmax(0,1fr)] items-center gap-x-1.5 sm:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] sm:gap-x-3">
        <span className="flex items-center justify-center gap-1.5 rounded-lg border border-[#6d3a85] bg-[#2a1733] px-2 py-1.5 text-xs font-extrabold uppercase tracking-wide text-[#e3b3f5] sm:text-sm">
          <img src={PASS_ICON.free} alt="" width={28} height={19} className="shrink-0 [image-rendering:pixelated]" />
          Grátis
        </span>
        <span aria-hidden />
        <span className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-extrabold uppercase tracking-wide sm:text-sm ${st.vipAtivo ? "border-edge bg-[#3a2a12] text-poke-gold" : "border-[#7a5a1c] bg-[#2b200d] text-poke-gold/80"}`}>
          <img src={PASS_ICON.vip} alt="" width={28} height={19} className="shrink-0 [image-rendering:pixelated]" />
          Premium
          {st.vipAtivo ? <Check className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
        </span>
      </div>

      {/* Trilha: coluna grátis, dia no meio, coluna premium */}
      <ol className="relative mt-3 space-y-2.5 before:absolute before:inset-y-2 before:left-1/2 before:w-1.5 before:-translate-x-1/2 before:rounded-full before:bg-black/45 before:content-['']">
        {TRILHA.map((step) => {
          const fs = freeStatus(st, step.dia);
          const vs = vipStatus(st, step.dia);
          const isToday = step.dia === st.degrau;
          return (
            <li
              key={step.dia}
              className={`relative grid grid-cols-[minmax(0,1fr)_2.25rem_minmax(0,1fr)] items-center gap-x-1.5 sm:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] sm:gap-x-3 ${isToday ? "pb-3" : ""}`}
            >
              <DayCard step={step} track="free" status={fs} locked={false} />
              <Node step={step} today={isToday} />
              <DayCard step={step} track="vip" status={vs} locked={!st.vipAtivo} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ cabeçalho do dia
const MARCOS = [7, 14, 21, 28, 30];

/** Barra do ciclo: cinco marcos (os baús), a barra enche conforme os dias resgatados. */
function Milestones({ feitos }: { feitos: number }) {
  // posição de cada marco: 20% de espaço por baú; entre dois marcos a barra enche pelos dias
  const stops = [0, ...MARCOS];
  let pct = 0;
  for (let i = 1; i < stops.length; i++) {
    if (feitos >= stops[i]) pct = (i / MARCOS.length) * 100;
    else {
      pct = ((i - 1) / MARCOS.length) * 100 + ((feitos - stops[i - 1]) / (stops[i] - stops[i - 1])) * (100 / MARCOS.length);
      break;
    }
  }
  return (
    <div className="relative mx-3 h-8 sm:mx-4" role="img" aria-label={`${feitos} de ${PASSE_DIAS} dias resgatados`}>
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-black/50" />
      <motion.div
        className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#8a3fb0] to-poke-gold"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: EASE }}
      />
      {MARCOS.map((d, i) => {
        const reached = feitos >= d;
        return (
          <span
            key={d}
            className={`absolute top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-xs ${reached ? "border-poke-gold bg-[#3a2a12] text-poke-gold" : "border-line bg-void text-mute"}`}
            style={{ left: `${((i + 1) / MARCOS.length) * 100}%` }}
            title={`Dia ${d}`}
          >
            {d === PASSE_DIAS ? <Trophy className="size-3.5" aria-hidden /> : "★"}
          </span>
        );
      })}
    </div>
  );
}

function Chip({ children, tone = "plain", title }: { children: React.ReactNode; tone?: "plain" | "gold" | "premium"; title?: string }) {
  const cls = tone === "gold" ? "border-[#7a5a1c] bg-[#33260e] text-poke-gold" : tone === "premium" ? "border-edge bg-[#3a2a12] text-poke-gold" : "border-line bg-void text-fg";
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold leading-none ${cls}`}>
      {children}
    </span>
  );
}

function Header({ acc, st, now, busy, online, onClaim }: { acc: AccountSnapshot; st: PassState; now: number; busy: boolean; online: boolean; onClaim: () => void }) {
  const levelOk = acc.level >= PASSE_NIVEL_MIN;
  const step = TRILHA[st.degrau - 1];
  const next = nextMilestone(st);
  const nextDay = st.degrau >= PASSE_DIAS ? 1 : st.degrau + 1;
  const hoje = dayOf(now);
  const zeraEm = dayStart(st.jaPegouHoje ? hoje + 2 : hoje + 1);
  const hasStreak = st.jaPegouHoje || st.degrau > 1;

  let button: React.ReactNode;
  const base = "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 px-4 py-2 text-sm font-extrabold uppercase tracking-wide transition-[transform,opacity] duration-200 sm:text-base";
  if (!levelOk) button = <button disabled className={`${base} border-line bg-void text-mute opacity-70`}>Libera no nível {PASSE_NIVEL_MIN}</button>;
  else if (!online) button = <button disabled className={`${base} border-line bg-void text-mute opacity-70`}>Conta offline</button>;
  else if (busy) button = <button disabled className={`${base} border-[#6d3a85] bg-[#3a1d4a] text-[#e3b3f5]`}><Loader2 className="size-4 animate-spin" aria-hidden /> Resgatando…</button>;
  else if (!st.jaPegouHoje)
    button = <button onClick={onClaim} className={`${base} border-[#c46ae8] bg-gradient-to-b from-[#b455dc] to-[#8a3fb0] text-white shadow-[0_0_18px_-4px_#c46ae8] hover:brightness-110 active:scale-[0.98]`}>Resgatar o dia {st.degrau}</button>;
  else if (st.vipPendenteHoje)
    button = <button onClick={onClaim} className={`${base} border-poke-gold bg-gradient-to-b from-[#f3c04a] to-[#c8923a] text-void shadow-[0_0_18px_-4px_#f3c04a] hover:brightness-110 active:scale-[0.98]`}><Crown className="size-4" aria-hidden /> Resgatar o premium do dia {st.degrau}</button>;
  else button = <button disabled className={`${base} border-line bg-void text-mute`}><Timer className="size-4" aria-hidden /> Dia {nextDay} em <b className="tnum text-fg">{clock(st.viradaEm, now)}</b></button>;

  return (
    <section className="card p-3 sm:p-4" aria-label="Dia de hoje">
      <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_16rem] lg:items-center lg:gap-5">
        <div className="flex items-center gap-3 sm:contents">
          {/* Medalha do dia */}
          <div
            className="relative grid size-20 shrink-0 place-items-center rounded-full border-4 bg-void text-center sm:size-24"
            style={{ borderColor: TIER[step.tier].color, boxShadow: `0 0 22px -4px ${TIER[step.tier].color}` }}
            aria-label={`Dia ${st.degrau} de ${PASSE_DIAS}`}
          >
            <span className="leading-none">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-mute">Dia</span>
              <span className="tnum block text-3xl font-black sm:text-4xl">{st.degrau}</span>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-mute">de {PASSE_DIAS}</span>
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:hidden">
            <HeaderChips st={st} next={next} hasStreak={hasStreak} now={now} />
          </div>
        </div>

        <div className="min-w-0 space-y-1.5">
          <div className="hidden flex-wrap items-center gap-1.5 sm:flex">
            <HeaderChips st={st} next={next} hasStreak={hasStreak} now={now} />
          </div>
          <Milestones feitos={st.feitos} />
          <p className="text-xs text-mute">
            <span className="tnum">{st.feitos}</span> de {PASSE_DIAS} dias
          </p>
        </div>

        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
          {button}
          <p className="text-center text-xs text-mute">
            {hasStreak && levelOk ? (
              <>
                A sequência zera em <b className="tnum text-fg">{clock(zeraEm, now)}</b>
              </>
            ) : (
              "O dia vira à meia-noite de Brasília."
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

function HeaderChips({ st, next, hasStreak, now }: { st: PassState; next: ReturnType<typeof nextMilestone>; hasStreak: boolean; now: number }) {
  return (
    <>
      {hasStreak && <Chip tone="gold" title="Dias seguidos resgatados">🔥 Sequência de {st.feitos}</Chip>}
      {next && (
        <Chip tone="plain" title={`Próximo baú: dia ${next.dia}`}>
          {next.dia === PASSE_DIAS ? "🏆" : "⭐"} {next.emDias === 0 ? `Dia ${next.dia} hoje` : next.emDias === 1 ? `Dia ${next.dia} amanhã` : `Dia ${next.dia} em ${next.emDias} dias`}
        </Chip>
      )}
      {st.vipAtivo && (
        <Chip tone="premium" title="Tempo restante do Passe Premium">
          <Crown className="size-3" aria-hidden /> Premium: faltam {vipLeft(st.vipAte, now)}
        </Chip>
      )}
      {st.ciclos > 0 && <Chip title="Ciclos de 30 dias completos">🏆 ×{pt.format(st.ciclos)}</Chip>}
      {st.total > 0 && <Chip>🏅 {pt.format(st.total)} {st.total === 1 ? "resgate" : "resgates"} no total</Chip>}
    </>
  );
}

function PremiumCard({ st, now }: { st: PassState; now: number }) {
  const t = trackTotals("vip");
  return (
    <section className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4" aria-label="Passe Premium">
      {/* O sprite tem 28×19 px: escala inteira (3×) e sem suavização, senão fica borrado. */}
      <img src={PASS_ICON.vip} alt="" width={84} height={57} className="hidden shrink-0 [image-rendering:pixelated] sm:block" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-extrabold uppercase tracking-wide text-poke-gold sm:text-lg">Passe Premium</h3>
          {st.vipAtivo ? <Chip tone="premium">Ativo · faltam {vipLeft(st.vipAte, now)}</Chip> : <Chip tone="gold"><Lock className="size-3" aria-hidden /> Bloqueado</Chip>}
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-mute sm:text-sm">
          <span>
            <b className="tnum text-fg">{pt.format(t.boostHours)}</b> h de boosts
          </span>
          <span>
            <b className="tnum text-fg">{shortQty(t.coins)}</b> de Coins
          </span>
          <span>
            <b className="tnum text-fg">{pt.format(t.beast)}</b> Beast Balls
          </span>
          <span>
            <b className="tnum text-fg">{t.vipDays}</b> dias de VIP
          </span>
        </p>
        <p className="text-xs text-mute">
          {st.vipAtivo ? "Os prêmios premium do dia saem junto com o resgate." : "Para liberar a trilha premium, compre o passe dentro do jogo (50 diamantes). O painel só resgata o dia."}
        </p>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ tela
type Reward = { nick: string; claim: NonNullable<ClaimResult["claim"]> } | null;

export function PassView() {
  const ids = useAccountIds();
  const accounts = useAccountsMap();
  const now = useNow();
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reward, setReward] = useState<Reward>(null);

  const selected = ids.includes(picked) ? picked : (ids.find((i) => accounts[i]?.status === "online") ?? ids[0] ?? "");
  const acc = accounts[selected];
  const st = useMemo(() => passState(acc?.pass, now), [acc?.pass, now]);
  const online = acc?.status === "online";

  useEffect(() => {
    if (!msg?.ok && !reward) return;
    const t = setTimeout(() => {
      setMsg((m) => (m?.ok ? null : m));
      setReward(null);
    }, 9000);
    return () => clearTimeout(t);
  }, [msg, reward]);

  const claimOne = useCallback(async (id: string): Promise<boolean> => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const r = await passApi.claim(id);
      const nick = accounts[id]?.nick ?? id;
      if (r.confirmed && r.claim) {
        setReward({ nick, claim: r.claim });
        setMsg({ ok: true, text: `${nick} resgatou o dia ${r.claim.degrau}.` });
        return true;
      }
      setMsg({ ok: false, text: `O jogo não confirmou o resgate de ${nick}. Tente de novo em alguns segundos.` });
      return false;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Não foi possível resgatar." });
      return false;
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }, [accounts]);

  // Contas que têm algo para resgatar agora (online, nível ok e o dia ainda não pego).
  const claimable = ids.filter((id) => {
    const a = accounts[id];
    if (!a || a.status !== "online" || a.level < PASSE_NIVEL_MIN) return false;
    const s = passState(a.pass, now);
    return !s.jaPegouHoje || s.vipPendenteHoje;
  });

  const claimAll = async () => {
    setMsg(null);
    const results = await Promise.all(claimable.map((id) => claimOne(id)));
    const n = results.filter(Boolean).length;
    if (claimable.length > 1) setMsg({ ok: n === claimable.length, text: `Resgatado em ${n} de ${claimable.length} contas.` });
  };

  if (!ids.length) return <p className="card p-10 text-center text-mute">Aguardando dados da VPS…</p>;
  if (!acc) return null;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Conta */}
      <Reveal index={0}>
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Conta do passe">
          <span className="label mr-1">Conta</span>
          {ids.map((id) => {
            const a = accounts[id];
            const on = id === selected;
            const s = passState(a?.pass, now);
            const pending = a && a.status === "online" && a.level >= PASSE_NIVEL_MIN && (!s.jaPegouHoje || s.vipPendenteHoje);
            return (
              <button key={id} type="button" role="radio" aria-checked={on} className="btn" data-active={on} onClick={() => { setPicked(id); setMsg(null); setReward(null); }}>
                <span className={`size-2 rounded-full ${a?.status === "online" ? "bg-poke-green" : "bg-mute"}`} aria-hidden />
                {a?.nick ?? id}
                {pending && <span className="rounded-full bg-[#8a3fb0] px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-white" title="Tem o dia para resgatar">resgatar</span>}
              </button>
            );
          })}
          {claimable.length > 1 && (
            <button type="button" className="btn ml-auto border-[#6d3a85] bg-[#3a1d4a] text-[#e3b3f5]" disabled={Object.values(busy).some(Boolean)} onClick={() => void claimAll()}>
              Resgatar em {claimable.length} contas
            </button>
          )}
        </div>
      </Reveal>

      {msg && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-[#2f6b3a] bg-[#16301c] text-poke-green" : "border-[#7a5a1c] bg-[#33260e] text-poke-gold"}`} role="status">
          {msg.text}
        </p>
      )}

      {reward && (
        <Reveal index={0}>
          <section className="tile tile-gold space-y-2 p-3" aria-label="Prêmios resgatados">
            <p className="text-sm font-bold">
              Prêmios do dia {reward.claim.degrau} · {reward.nick}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {reward.claim.premios.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 text-xs">
                  <PrizeIcon p={p} size={28} />
                  {p.trilha === "vip" && <Crown className="size-3 text-poke-gold" aria-label="Premium" />}
                </span>
              ))}
            </div>
          </section>
        </Reveal>
      )}

      <Reveal index={1}>
        <Header acc={acc} st={st} now={now} busy={!!busy[selected]} online={online} onClaim={() => void claimOne(selected)} />
      </Reveal>

      {st.quebrou && (
        <p className="rounded-lg border border-line bg-[#2a1f2c] px-3 py-2 text-sm text-[#e3b3f5]" role="status">
          Esta conta perdeu um dia e a trilha voltou ao dia 1. Volte todo dia para chegar ao dia {PASSE_DIAS}!
        </p>
      )}

      <Reveal index={2}>
        <PremiumCard st={st} now={now} />
      </Reveal>

      <Reveal index={3}>
        <div className="card p-2.5 sm:p-4">
          <Trail st={st} />
        </div>
      </Reveal>
    </div>
  );
}

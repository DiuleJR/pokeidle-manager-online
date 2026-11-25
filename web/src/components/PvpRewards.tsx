import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Gem, Loader2, Trophy, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BOOSTS,
  clockOf,
  countdown,
  DIAMOND_ICON,
  EGG_TIER_ORDER,
  EGGS,
  eggsOf,
  GEM_ICON,
  MEDAL_ICON,
  monthlyApi,
  MONTHLY_MIN_DAYS,
  MONTHLY_MIN_MATCHES,
  MONTHLY_REASON,
  monthName,
  prizeAt,
  rankLine,
  simulateBands,
  boostTime,
  TIER_EGGS,
  TOP_AWARDED,
  WEEKLY_PRIZES,
  type BoostKey,
  type Clock,
  type ClockKind,
  type Eggs,
  type MonthlyBand,
  type MonthlyTop,
  type WeeklyPrize,
} from "@/lib/pvpRewards";
import { useScrollLock } from "@/lib/scrollLock";
import { PLACEMENT_MATCHES, rankIcon, TIER_COLOR, TIER_NAME, type PvpAccount } from "@/lib/pvp";
import { everyWhileVisible } from "@/lib/visible";

const EASE = [0.22, 1, 0.36, 1] as const;
const nf = new Intl.NumberFormat("pt-BR");
const VIOLET = "#b66bff";
const GOLD = "#f3c04a";

/** Relógio de 1 s só enquanto alguém precisa dele. */
function useClock(kind: ClockKind): Clock {
  const [c, set] = useState(() => clockOf(kind));
  useEffect(() => {
    set(clockOf(kind));
    return everyWhileVisible(() => set(clockOf(kind)), 1000);
  }, [kind]);
  return c;
}

// ------------------------------------------------------------------ botões com contador
function ClockButton({ kind, onOpen }: { kind: ClockKind; onOpen: () => void }) {
  const c = useClock(kind);
  const week = kind === "week";
  const accent = week ? GOLD : VIOLET;
  const hot = c.mood === "brasa" || c.mood === "apurando";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${week ? "Recompensas semanais" : "Top PVP mensal"}: ${c.counting ? "apurando" : `faltam ${countdown(c.left)}`}. Abrir`}
      className="group relative flex min-h-14 min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-xl border-2 bg-tile px-3 py-2 text-left transition-colors hover:bg-[#1f1610] focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-4"
      style={{ borderColor: accent, outlineColor: accent }}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${accent}22`, color: accent }}>
        {week ? <Trophy className="size-5" aria-hidden /> : <Gem className="size-5" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-bold uppercase tracking-wide text-mute">{week ? "Semanal zera em" : "Mensal fecha em"}</span>
        <span className={`tnum block text-lg font-extrabold leading-tight sm:text-xl ${hot ? "text-poke-red" : "text-fg"}`}>
          {c.counting ? "Apurando…" : countdown(c.left)}
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-mute transition-transform group-hover:translate-x-0.5" aria-hidden />
      <span className="absolute inset-x-0 bottom-0 h-1 bg-black/40" aria-hidden>
        <i className="block h-full origin-left" style={{ background: accent, transform: `scaleX(${c.progress.toFixed(4)})` }} />
      </span>
    </button>
  );
}

export function PvpRewardClocks({ accounts }: { accounts: PvpAccount[] }) {
  const [open, setOpen] = useState<ClockKind | null>(null);
  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
        <ClockButton kind="week" onOpen={() => setOpen("week")} />
        <ClockButton kind="month" onOpen={() => setOpen("month")} />
      </div>
      <AnimatePresence>
        {open === "week" && <WeeklyRewards key="w" accounts={accounts} onClose={() => setOpen(null)} />}
        {open === "month" && <MonthlyTop key="m" accounts={accounts} onClose={() => setOpen(null)} />}
      </AnimatePresence>
    </>
  );
}

// ------------------------------------------------------------------ janela
function Sheet({ title, icon, onClose, children, extra }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode; extra?: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useScrollLock();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-0 backdrop-blur-sm sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.22, ease: EASE }}
        className="card flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-none sm:h-auto sm:max-h-[94dvh] sm:rounded-2xl"
      >
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 sm:px-4">
          <h2 className="flex min-w-0 items-center gap-2 text-base font-extrabold sm:text-lg">
            {icon}
            <span className="truncate">{title}</span>
          </h2>
          <div className="flex items-center gap-1.5">
            {extra}
            <button ref={closeRef} type="button" className="btn" onClick={onClose} aria-label="Fechar"><X className="size-4" aria-hidden /></button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">{children}</div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** Troca a conta cujos dados aparecem (a posição é de cada conta). */
function AccountPick({ accounts, value, onChange }: { accounts: PvpAccount[]; value: number; onChange: (id: number) => void }) {
  if (accounts.length < 2) return null;
  return (
    <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Conta">
      {accounts.map((a) => (
        <button
          key={a.id}
          type="button"
          role="tab"
          aria-selected={a.id === value}
          onClick={() => onChange(a.id)}
          className={`min-h-9 shrink-0 rounded-lg border px-3 text-sm font-bold transition-colors ${a.id === value ? "border-[#b66bff] bg-[#3a2352] text-white" : "border-line text-mute hover:text-white"}`}
        >
          {a.nick}
        </button>
      ))}
    </div>
  );
}

const Chip = ({ icon, name, value }: { icon: string; name: string; value: string }) => (
  <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-black/25 py-1 pl-1.5 pr-2.5" title={`${name} ${value}`}>
    <img src={icon} alt="" width={24} height={24} loading="lazy" className={`size-6 shrink-0 object-contain [image-rendering:pixelated]`} />
    <span className="min-w-0 text-xs leading-tight">
      <span className="block truncate text-fg">{name}</span>
      <b className="tnum text-poke-gold">{value}</b>
    </span>
  </span>
);

const EggChips = ({ eggs }: { eggs: Eggs | null }) => (
  <>
    {(["p2", "p3", "p4"] as const).filter((k) => (eggs?.[k] ?? 0) > 0).map((k) => (
      <Chip key={k} icon={EGGS[k].icon} name={EGGS[k].name} value={`×${eggs?.[k]}`} />
    ))}
  </>
);

// ------------------------------------------------------------------ recompensas semanais
function weekPreview(a: PvpAccount | undefined, clock: Clock) {
  if (clock.counting) return { title: "Apurando a virada…", sub: "Os prêmios da semana passada estão sendo entregues.", prize: null, eggs: null as Eggs | null, pos: 0 };
  const rank = a?.rank;
  if (!a || !rank) return { title: "Carregando…", sub: "", prize: null, eggs: null, pos: 0 };
  if ((rank.partidas ?? 0) < PLACEMENT_MATCHES) {
    const left = PLACEMENT_MATCHES - (rank.partidas ?? 0);
    return { title: `Faltam ${left} ${left === 1 ? "partida" : "partidas"} de posicionamento`, sub: `Termine as ${PLACEMENT_MATCHES} partidas para entrar na Tabela.`, prize: null, eggs: null, pos: 0 };
  }
  const pos = Number(a.finalPosition ?? a.position) || 0;
  const prize = prizeAt(pos);
  const eggs = eggsOf(pos, rank.tierId);
  if (prize) return { title: rankLine(pos), sub: prize.sub, prize, eggs, pos };
  const cut = a.finalCut != null ? Number(a.finalCut) : NaN;
  const missing = Number.isFinite(cut) ? Math.max(1, cut - (rank.pontos || 0) + 1) : 0;
  return {
    title: pos < 1 ? "Sem posição na Tabela" : rankLine(pos),
    sub: pos >= 1 && missing > 0 ? `Faltam ${nf.format(missing)} PR para entrar no Top ${TOP_AWARDED}.` : pos >= 1 ? `Fora do Top ${TOP_AWARDED}: leva os ovos da sua faixa.` : eggs ? "Você leva os ovos da sua faixa." : "Jogue partidas para subir de faixa e ganhar ovos.",
    prize: null,
    eggs,
    pos,
  };
}

function PrizeChips({ prize, eggs }: { prize: WeeklyPrize | null; eggs: Eggs | null }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {prize && (Object.entries(prize.hours) as [BoostKey, number][]).map(([k, h]) => <Chip key={k} icon={BOOSTS[k].icon} name={BOOSTS[k].name} value={boostTime(h)} />)}
      <EggChips eggs={eggs} />
      {prize && prize.diamonds > 0 && <Chip icon={DIAMOND_ICON} name="Diamantes" value={nf.format(prize.diamonds)} />}
    </div>
  );
}

function WeeklyRewards({ accounts, onClose }: { accounts: PvpAccount[]; onClose: () => void }) {
  const clock = useClock("week");
  const [accId, setAccId] = useState(() => (accounts.find((a) => a.rank && a.online) ?? accounts[0])?.id ?? 0);
  const a = accounts.find((x) => x.id === accId) ?? accounts[0];
  const pre = weekPreview(a, clock);
  const tier = a?.rank?.tierId ?? "";
  const myTier = tier === "challenger" ? "graomestre" : tier;
  return (
    <Sheet title="Recompensas do PVP ranqueado" icon={<Trophy className="size-5 shrink-0" style={{ color: GOLD }} aria-hidden />} onClose={onClose}>
      <AccountPick accounts={accounts} value={accId} onChange={setAccId} />

      <section className="rounded-xl border-2 bg-[#241631] p-3" style={{ borderColor: "#7a5a1a" }} aria-live="polite">
        <p className="text-[11px] font-bold uppercase tracking-wide text-mute">Se a semana acabasse agora</p>
        <div className="mt-2 flex items-center gap-3">
          {a?.rank ? (
            <img src={rankIcon(a.rank.tierId)} alt={TIER_NAME[a.rank.tierId] ?? ""} width={48} height={48} className="size-12 shrink-0 object-contain" />
          ) : (
            <span className="size-12 shrink-0 rounded-full bg-black/30" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="text-base font-extrabold sm:text-lg">{pre.title}</p>
            {pre.sub && <p className="text-sm text-mute">{pre.sub}</p>}
          </div>
        </div>
        {(pre.prize || pre.eggs) && (
          <div className="mt-2.5">
            <PrizeChips prize={pre.prize} eggs={pre.eggs} />
          </div>
        )}
      </section>

      <details className="group mt-3 rounded-xl border border-line bg-tile">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-bold [&::-webkit-details-marker]:hidden">
          <CircleHelp className="size-4 text-mute" aria-hidden /> Como funciona a virada
          <span className="hidden text-xs font-normal text-mute sm:inline">por que zera, quando paga e quem recebe</span>
          <ChevronDown className="ml-auto size-4 text-mute transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="space-y-2 px-3 pb-3 text-sm text-mute">
          <li><b className="text-fg">Quando.</b> Todo sábado às 23h59 (horário de Brasília) a Tabela fecha e os prêmios saem pela posição final. A semana nova começa zerada.</li>
          <li><b className="text-fg">Quem recebe.</b> Do 1º ao 100º pela posição; do 101º para baixo, pelo tier. Só entra quem terminou o posicionamento e jogou nas últimas 24 horas.</li>
          <li><b className="text-fg">Como chega.</b> Boosts e ovos entram sozinhos na conta, sem precisar estar online na virada.</li>
        </ul>
      </details>

      <p className="mt-3 text-sm text-mute">
        Pagas todo <b className="text-fg">sábado, 23h59 (Brasília)</b>, pela posição final na Tabela e, do 101º para baixo, pelo seu tier.{" "}
        Fecha em <b className="tnum text-fg">{clock.counting ? "…" : countdown(clock.left)}</b>
      </p>

      <ul className="mt-2 space-y-2">
        {WEEKLY_PRIZES.map((p) => {
          const mine = pre.pos >= p.from && pre.pos <= p.to;
          return (
            <li key={p.key} className={`rounded-xl border bg-tile p-2.5 ${mine ? "border-2" : "border-line"}`} style={mine ? { borderColor: GOLD } : undefined}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex w-32 shrink-0 items-center gap-2">
                  <img src={p.art.medal ? MEDAL_ICON[p.art.medal] : rankIcon(p.art.tier ?? "challenger")} alt="" width={36} height={36} className="size-9 object-contain [image-rendering:pixelated]" />
                  <div className="leading-tight">
                    <b className="block text-sm">{p.label}</b>
                    <span className="text-xs text-mute">{mine ? "Você está aqui" : p.sub}</span>
                  </div>
                </div>
                <PrizeChips prize={p} eggs={{ p4: 2 }} />
              </div>
            </li>
          );
        })}
      </ul>

      <h3 className="mt-5 text-xs font-extrabold uppercase tracking-wide text-mute">Ovos da semana</h3>
      <p className="mt-1 text-sm text-mute">
        Além do prêmio de posição, a virada dá <b className="text-fg">Mystery Eggs</b>: o Top 100 leva 2× Mystery Egg P4 (acima) e, daí para baixo, cada faixa leva o pacote do seu tier. Os ovos chegam na mochila e chocam na Chocadeira.
      </p>
      <ul className="mt-2 space-y-2">
        {EGG_TIER_ORDER.map((t) => {
          const eggs = TIER_EGGS[t] ?? null;
          const mine = myTier === t;
          return (
            <li key={t} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border bg-tile p-2.5 ${mine ? "border-2" : "border-line"}`} style={mine ? { borderColor: GOLD } : undefined}>
              <div className="flex w-32 shrink-0 items-center gap-2">
                <img src={rankIcon(t)} alt="" width={36} height={36} loading="lazy" className="size-9 object-contain" />
                <div className="leading-tight">
                  <b className="block text-sm" style={{ color: TIER_COLOR[t] }}>{TIER_NAME[t]}</b>
                  {mine && <span className="text-xs text-mute">Você está aqui</span>}
                </div>
              </div>
              {eggs ? <EggChips eggs={eggs} /> : <span className="text-sm text-mute">sem ovos</span>}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-mute">
        A escada zera todo sábado, 23h59 (Brasília), e a tabela final daquele instante é a que premia. Só entra quem terminou o posicionamento e jogou nas últimas 24 horas: um dia sem jogar derruba Mestre, Grão-Mestre e Challenger para o Diamante antes da virada. Os ovos do tier valem para todo mundo que terminou o posicionamento, na tabela final ou não.
      </p>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Top mensal
function useMonthly(account: number, page: number) {
  const [data, setData] = useState<MonthlyTop | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async (silent = false) => {
    const mine = ++seq.current;
    if (!silent) setLoading(true);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const d = await monthlyApi.get(account, page);
        if (mine !== seq.current) return;
        setData(d);
        setErr("");
        setLoading(false);
        return;
      } catch (e) {
        if (mine !== seq.current) return;
        if (attempt === 2) {
          setErr(e instanceof Error ? e.message : "Falha ao ler o Top mensal");
          setLoading(false);
          return;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  }, [account, page]);

  useEffect(() => {
    void load();
    const stop = everyWhileVisible(() => void load(true), 60_000);
    return () => {
      seq.current++;
      stop();
    };
  }, [load]);
  return { data, err, loading, retry: () => void load() };
}

const simValue = (step: number) => {
  const v = 10 ** (4 + (Math.max(0, Math.min(100, step)) / 100) * 4);
  const order = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / order) * order;
};
const simStep = (v: number) => Math.round(((Math.log10(Math.max(1e4, Math.min(1e8, v))) - 4) / 4) * 100);

function Gem14({ n = 14 }: { n?: number }) {
  return <img src={GEM_ICON} alt="gemas" width={n} height={n} className="inline-block align-[-2px] [image-rendering:pixelated]" style={{ width: n, height: n }} />;
}
const bandLabel = (f: Pick<MonthlyBand, "de" | "ate">) => (f.de === f.ate ? `${f.de}º` : `${nf.format(f.de)}º ao ${nf.format(f.ate)}º`);
const pct = (bp: number) => (bp / 100).toLocaleString("pt-BR");

function MonthlyTop({ accounts, onClose }: { accounts: PvpAccount[]; onClose: () => void }) {
  const clock = useClock("month");
  const [accId, setAccId] = useState(() => (accounts.find((a) => a.online) ?? accounts[0])?.id ?? 1);
  const [page, setPage] = useState(0);
  const [help, setHelp] = useState(false);
  const [sim, setSim] = useState<number | null>(null);
  const { data, err, loading, retry } = useMonthly(accId, page);
  const tableRef = useRef<HTMLElement>(null);
  const myPage = data?.eu?.pos ? Math.floor((data.eu.pos - 1) / (data.tabela?.porPagina || 100)) : null;

  const total = data?.tabela?.total ?? 0;
  const per = data?.tabela?.porPagina || 100;
  const pages = Math.max(1, Math.ceil(total / per));
  const goto = (p: number) => {
    setPage(Math.max(0, Math.min(pages - 1, p)));
    requestAnimationFrame(() => tableRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const minMatches = data?.partidasMin ?? MONTHLY_MIN_MATCHES;
  const minDays = data?.contaDiasMin ?? MONTHLY_MIN_DAYS;
  const prizeOf = (vaga: number) => data?.faixas.find((f) => vaga >= f.de && vaga <= f.ate)?.porPosicao ?? 0;

  const base = sim ?? (data && data.arrecadado > 1e4 ? simValue(simStep(data.arrecadado)) : 1_000_000);
  const bands = useMemo(() => simulateBands(base), [base]);

  return (
    <Sheet
      title="Top PVP mensal"
      icon={<Gem className="size-5 shrink-0" style={{ color: VIOLET }} aria-hidden />}
      onClose={onClose}
      extra={<button type="button" className="btn" aria-expanded={help} aria-controls="pvpm-help" onClick={() => setHelp((h) => !h)} aria-label="Como funciona o Top mensal"><CircleHelp className="size-4" aria-hidden /></button>}
    >
      <AccountPick accounts={accounts} value={accId} onChange={(id) => { setAccId(id); setPage(0); }} />

      {help && (
        <section id="pvpm-help" className="mb-3 rounded-xl border border-line bg-tile p-3 text-sm text-mute">
          <ul className="space-y-2">
            <li><b className="text-fg">Pontos.</b> Cada vitória no PVP ranqueado soma pontos no mês; a Tabela mensal ordena por eles.</li>
            <li><b className="text-fg">Partidas válidas.</b> São necessárias {minMatches} partidas válidas no mês e uma conta com pelo menos {minDays} dias.</li>
            <li><b className="text-fg">Prêmio.</b> {pct(data?.pctBp ?? 5000)}% da arrecadação das comissões do Mercado em Gemas vira prêmio, dividido entre as 2.000 primeiras vagas.</li>
            <li><b className="text-fg">Fechamento.</b> Dia 1º, 00h de Brasília; o resultado sai às 00h05 e as Gemas entram sozinhas.</li>
          </ul>
          <div className="mt-3 rounded-lg bg-black/25 p-2.5">
            <label htmlFor="pvpm-sim" className="block text-xs">Se o mês arrecadasse <b className="tnum text-fg">{nf.format(base)}</b> <Gem14 /></label>
            <input id="pvpm-sim" type="range" min={0} max={100} step={1} value={simStep(base)} onChange={(e) => setSim(simValue(Number(e.target.value)))} className="mt-2 w-full accent-[#b66bff]" />
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {bands.map((f) => (
                <li key={f.de} className="flex justify-between gap-2"><b className="text-fg">{bandLabel(f)}</b><span className="tnum">{nf.format(f.porPosicao)} <Gem14 n={12} /> cada</span></li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {err && !data && (
        <div className="rounded-xl bg-poke-red/10 p-3 text-sm text-poke-red" role="alert">
          {err} <button type="button" className="btn ml-2" onClick={retry}>Tentar de novo</button>
        </div>
      )}
      {!data && !err && <p className="flex items-center justify-center gap-2 py-12 text-mute"><Loader2 className="size-4 animate-spin" aria-hidden /> Carregando o Top mensal…</p>}

      {data && (
        <>
          <section className="flex flex-col gap-3 rounded-xl border-2 bg-[#241631] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4" style={{ borderColor: "#6b4a99" }}>
            <div className="flex items-center gap-3">
              <img src={GEM_ICON} alt="" width={56} height={56} className="size-14 shrink-0 object-contain [image-rendering:pixelated]" />
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-mute">Arrecadação do Mercado em {monthName(data.mes)}</p>
                <p className="tnum text-3xl font-extrabold leading-tight text-poke-gold sm:text-4xl">{nf.format(data.arrecadado)} <span className="text-base font-bold text-fg">Gemas</span></p>
                <p className="text-xs text-mute">comissão de {nf.format(data.vendas ?? 0)} vendas em Gemas no Mercado da Comunidade</p>
                <p className="mt-1.5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-bold" style={{ borderColor: VIOLET }}>
                  {pct(data.pctBp ?? 5000)}% vira prêmio <b className="tnum text-poke-gold">{nf.format(data.pool ?? 0)}</b> <Gem14 n={16} />
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-line bg-black/25 p-3 sm:w-52 sm:shrink-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-mute">Fim do mês</p>
              <p className={`tnum mt-0.5 text-lg font-extrabold ${clock.mood === "brasa" ? "text-poke-red" : ""}`}>{clock.counting ? "Apurando…" : `Fecha em ${countdown(clock.left)}`}</p>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-black/40" aria-hidden>
                <i className="block h-full origin-left rounded-full" style={{ background: GOLD, transform: `scaleX(${clock.progress.toFixed(4)})` }} />
              </span>
              <p className="mt-1.5 text-[11px] leading-snug text-mute">dia 1º, 00h de Brasília; o resultado sai às 00h05</p>
            </div>
          </section>

          <section className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="Prêmio por faixa">
            {data.faixas.map((f, i) => {
              const mine = (data.eu?.vaga ?? 0) >= f.de && (data.eu?.vaga ?? 0) <= f.ate;
              return (
                <article key={f.de} className={`flex items-center gap-3 rounded-xl border bg-tile p-3 sm:flex-col sm:items-start ${mine ? "border-2" : "border-line"}`} style={mine ? { borderColor: GOLD } : undefined}>
                  <img src={MEDAL_ICON[i + 1] ?? MEDAL_ICON[3]} alt="" width={40} height={40} className="size-10 shrink-0 object-contain [image-rendering:pixelated]" />
                  <div className="min-w-0 flex-1 leading-tight">
                    <b className="block text-sm">{bandLabel(f)}</b>
                    <span className="text-xs text-mute">{pct(f.bp)}% da arrecadação</span>
                    <b className="tnum mt-1 block text-lg text-poke-gold">{nf.format(f.porPosicao)} <Gem14 n={16} /></b>
                    <span className="text-[11px] uppercase tracking-wide text-mute">cada</span>
                  </div>
                  {mine && <span className="rounded-full bg-[#3a2352] px-2 py-0.5 text-[11px] font-extrabold" style={{ color: GOLD }}>Você</span>}
                </article>
              );
            })}
          </section>

          <MyLine d={data} minMatches={minMatches} minDays={minDays} prizeOf={prizeOf} />

          <section ref={tableRef} className="mt-4 scroll-mt-2" aria-label={`Tabela de ${monthName(data.mes)}`}>
            <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold uppercase tracking-wide">Tabela de {monthName(data.mes)}</h3>
              {myPage != null && myPage !== page && <button type="button" className="btn text-xs" onClick={() => goto(myPage)}>Minha posição</button>}
            </header>
            {total ? (
              <div className={`overflow-hidden rounded-lg border border-line transition-opacity ${loading ? "opacity-60" : ""}`} role="table" aria-label="Top mensal" aria-busy={loading}>
                <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_5.5rem] bg-tile px-2 py-1.5 text-xs font-semibold text-mute sm:grid-cols-[3rem_minmax(0,1fr)_5rem_6rem_4.5rem_7rem]" role="row">
                  <span role="columnheader">#</span><span role="columnheader">Treinador</span><span className="text-right" role="columnheader">Pontos</span>
                  <span className="hidden text-right sm:block" role="columnheader">V / D</span><span className="hidden text-right sm:block" role="columnheader">Válidas</span>
                  <span className="text-right" role="columnheader">Prêmio</span>
                </div>
                <div className="max-h-[32rem] overflow-y-auto">
                  {(data.tabela?.linhas ?? []).map((r) => {
                    const [pos, vaga, nick, pontos, v, d, validas, motivo] = r;
                    const mine = pos === data.eu?.pos;
                    const why = !vaga ? (MONTHLY_REASON[motivo] ?? MONTHLY_REASON[""]) : null;
                    const prize = vaga ? prizeOf(vaga) : 0;
                    return (
                      <div key={pos} role="row" className={`grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_5.5rem] items-center border-t border-line px-2 py-1.5 text-sm sm:grid-cols-[3rem_minmax(0,1fr)_5rem_6rem_4.5rem_7rem] ${mine ? "bg-[#2e1f45]" : ""} ${!vaga ? "opacity-70" : ""}`}>
                        <span role="cell" className="tnum">{vaga && vaga <= 3 ? <img src={MEDAL_ICON[vaga]} alt={`${vaga}º`} width={22} height={22} className="size-5 object-contain [image-rendering:pixelated]" /> : <span className="text-mute">{vaga ? nf.format(vaga) : "—"}</span>}</span>
                        <span role="cell" className="truncate font-semibold" style={mine ? { color: VIOLET } : undefined}>{nick}{mine && <b className="ml-1.5 text-[10px]">VOCÊ</b>}</span>
                        <span role="cell" className="tnum text-right font-bold text-poke-gold">{nf.format(pontos)}</span>
                        <span role="cell" className="tnum hidden text-right text-mute sm:block">{nf.format(v)} / {nf.format(d)}</span>
                        <span role="cell" className={`tnum hidden text-right sm:block ${validas < minMatches ? "text-poke-red" : "text-mute"}`}>{nf.format(validas)}</span>
                        <span role="cell" className="tnum text-right">
                          {prize > 0 ? <>{nf.format(prize)} <Gem14 /></> : <span className="text-xs text-mute" title={why?.hint}>{why?.label}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-line p-4 text-center text-sm text-mute">Ainda não há ninguém na Tabela deste mês.</p>
            )}
            {total > 0 && (
              <nav className="mt-2 flex items-center justify-center gap-2" aria-label="Páginas da tabela">
                <button type="button" className="btn" disabled={page <= 0 || loading} onClick={() => goto(page - 1)} aria-label="Página anterior"><ChevronLeft className="size-4" aria-hidden /></button>
                <span className="tnum min-w-28 text-center text-sm text-mute">Página {nf.format(page + 1)} de {nf.format(pages)}</span>
                <button type="button" className="btn" disabled={page >= pages - 1 || loading} onClick={() => goto(page + 1)} aria-label="Próxima página"><ChevronRight className="size-4" aria-hidden /></button>
              </nav>
            )}
          </section>

          <Previous d={data} />
        </>
      )}
    </Sheet>
  );
}

function MyLine({ d, minMatches, minDays, prizeOf }: { d: MonthlyTop; minMatches: number; minDays: number; prizeOf: (v: number) => number }) {
  const eu = d.eu ?? {};
  const valid = Number(eu.validas) || 0;
  const missing = Math.max(0, minMatches - valid);
  let text: string;
  let tone: "ok" | "wait" | "out";
  if (eu.vaga) [text, tone] = [`Você está no prêmio: ${nf.format(prizeOf(eu.vaga))} Gemas se o mês fechasse agora.`, "ok"];
  else if (eu.motivo === "equipe") [text, tone] = ["Contas da mesma equipe do jogo não concorrem ao prêmio.", "out"];
  else if (eu.motivo === "conta") [text, tone] = [`A conta precisa ter pelo menos ${minDays} dias para concorrer.`, "out"];
  else if (missing > 0 && (eu.motivo === "partidas" || valid > 0)) [text, tone] = [`Faltam ${missing} ${missing === 1 ? "partida válida" : "partidas válidas"} para entrar na disputa.`, "wait"];
  else if (!(Number(eu.pontos) > 0)) [text, tone] = ["Ganhe partidas ranqueadas para somar pontos no mês.", "out"];
  else [text, tone] = ["Fora das 2.000 vagas por enquanto: cada vitória conta.", "wait"];
  const color = tone === "ok" ? "#6fd47c" : tone === "wait" ? GOLD : "#b39a6e";
  return (
    <section className="mt-3 rounded-xl border-2 bg-tile p-3" style={{ borderColor: `${color}88` }} aria-label="Sua posição no mês">
      <div className="grid grid-cols-3 gap-2 text-center sm:text-left">
        <div><small className="block text-[11px] uppercase tracking-wide text-mute">Sua posição</small><b className="tnum text-lg">{eu.vaga ? rankLine(eu.vaga) : "—"}</b></div>
        <div><small className="block text-[11px] uppercase tracking-wide text-mute">Seus pontos</small><b className="tnum text-lg">{nf.format(eu.pontos ?? 0)}</b></div>
        <div>
          <small className="block text-[11px] uppercase tracking-wide text-mute">Válidas (mín. {minMatches})</small>
          <b className="tnum text-lg">{nf.format(valid)}{missing > 0 ? <span className="text-sm text-mute">/{minMatches}</span> : <span style={{ color: "#6fd47c" }}> ✓</span>}</b>
        </div>
      </div>
      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-black/40" aria-hidden>
        <i className="block h-full origin-left rounded-full" style={{ background: color, transform: `scaleX(${Math.min(1, valid / Math.max(1, minMatches)).toFixed(3)})` }} />
      </span>
      <p className="mt-2 text-sm" style={{ color }}>{text}</p>
    </section>
  );
}

function Previous({ d }: { d: MonthlyTop }) {
  const a = d.anterior;
  const [y, m] = d.mes.split("-").map(Number);
  const prev = monthName(new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7));
  if (!a) {
    return (
      <section className="mt-4 rounded-xl border border-line bg-tile p-3">
        <h3 className="text-sm font-extrabold uppercase tracking-wide">Mês anterior · {prev}</h3>
        <p className="mt-1 text-sm text-mute">O primeiro resultado aparece aqui depois do fechamento do mês (dia 1º, às 00h05 de Brasília).</p>
      </section>
    );
  }
  const paid = a.status === "pago";
  const mp = a.meuPremio;
  return (
    <section className="mt-4 rounded-xl border border-line bg-tile p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold uppercase tracking-wide">Mês anterior · {prev}</h3>
        {a.premiados > 0 && <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${paid ? "bg-poke-green/15 text-poke-green" : "bg-poke-gold/15 text-poke-gold"}`}>{paid ? "Pago" : "Em conferência"}</span>}
      </header>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div><dt className="text-[11px] text-mute">Arrecadou</dt><dd className="tnum font-bold">{nf.format(a.arrecadado)} <Gem14 /></dd></div>
        <div><dt className="text-[11px] text-mute">Prêmio total</dt><dd className="tnum font-bold">{nf.format(a.gemas)} <Gem14 /></dd></div>
        <div><dt className="text-[11px] text-mute">Premiados</dt><dd className="tnum font-bold">{nf.format(a.premiados)}</dd></div>
      </dl>
      {a.top && a.top.length > 0 && (
        <ol className="mt-2 space-y-1 text-sm">
          {a.top.slice(0, 3).map((x, i) => (
            <li key={x.nick} className="flex items-center gap-2"><img src={MEDAL_ICON[i + 1]} alt={`${i + 1}º`} width={20} height={20} className="size-5 object-contain" /><b className="min-w-0 flex-1 truncate">{x.nick}</b><span className="tnum">{nf.format(x.gemas)} <Gem14 /></span></li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-sm text-mute">
        {mp ? `${rankLine(mp.posicao)}: ${nf.format(mp.gemas)} Gemas ${mp.creditado ? "já entraram na conta." : paid ? "estão entrando." : "serão pagas depois da conferência."}` : "Você não ficou entre os premiados."}
      </p>
    </section>
  );
}


import { useMemo, useState } from "react";
import { ItemSprite, PokemonSprite, ShinyMark } from "@/components/Sprites";
import { type MarketStats, type Moeda, type StatsBucket, type StatsDetail, type StatsGroup, type StatsPeriod, marketApi } from "@/lib/market";
import { fmtInt, fmtShort } from "@/lib/utils";
import { CurrencyToggle, ErrorBox, Loading, Money, Seg, useAsync } from "./shared";

const PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: "24h", label: "24 horas" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
];
const ITEM_COLOR = "#5cc8e8";
const POKE_COLOR = "#f3c04a";

const pct = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
const fmtPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const num = (n: number | null | undefined, moeda: Moeda) => (n == null ? "—" : moeda === "orb" && n < 100 ? n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : fmtShort(n));

/** Seta e porcentagem de variação; verde sobe, vermelho cai. `inverse` quando subir é ruim (não usado nos preços). */
function Delta({ value, label }: { value: number | null; label?: string }) {
  if (value == null) return <span className="text-xs text-mute">{label ?? "sem base"}</span>;
  const tone = value > 0.05 ? "text-poke-green" : value < -0.05 ? "text-poke-red" : "text-mute";
  return (
    <span className={`tnum text-xs font-bold ${tone}`}>
      {value > 0.05 ? "▲ " : value < -0.05 ? "▼ " : ""}
      {fmtPct(value)}
      {label ? <span className="font-medium text-mute"> {label}</span> : null}
    </span>
  );
}

// ------------------------------------------------------------------ baldes do gráfico
/** Completa os baldes sem venda com zero (hora a hora nas 24 h, dia a dia no resto). Chaves em horário de Brasília. */
function fill(series: StatsBucket[], hourly: boolean, days: number, now: number): StatsBucket[] {
  const byKey = new Map(series.map((b) => [b.k, b]));
  const step = hourly ? 3_600_000 : 86_400_000;
  const n = hourly ? 24 : days;
  const out: StatsBucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const iso = new Date(now - 3 * 3_600_000 - i * step).toISOString();
    const k = hourly ? `${iso.slice(0, 10)} ${iso.slice(11, 13)}:00` : iso.slice(0, 10);
    out.push(byKey.get(k) ?? { k, sales: 0, volume: 0, itemVolume: 0, pokemonVolume: 0 });
  }
  return out;
}
const bucketLabel = (k: string) => (k.length > 10 ? `${k.slice(11, 13)}h` : `${k.slice(8, 10)}/${k.slice(5, 7)}`);
const bucketTitle = (k: string) => (k.length > 10 ? `${k.slice(8, 10)}/${k.slice(5, 7)} às ${k.slice(11, 13)}h` : `${k.slice(8, 10)}/${k.slice(5, 7)}`);

// ------------------------------------------------------------------ gráficos (SVG, sem biblioteca)
function VolumeChart({ stats }: { stats: MarketStats }) {
  const data = useMemo(() => fill(stats.series, stats.hourly, stats.days, stats.now), [stats]);
  const [pick, setPick] = useState<number | null>(null);
  const max = Math.max(...data.map((b) => b.volume), 1);
  const W = 600;
  const H = 150;
  const gap = data.length > 14 ? 2 : 4;
  const bw = (W - gap * (data.length - 1)) / data.length;
  const sel = pick != null ? data[pick] : null;
  const total = data.reduce((s, b) => s + b.volume, 0);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-manipulation" role="img" aria-label={`Volume vendido por ${stats.hourly ? "hora" : "dia"}: total ${fmtInt(total)}`}>
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1={0} x2={W} y1={H * t} y2={H * t} stroke="#3b2b17" strokeWidth="1" />
        ))}
        {data.map((b, i) => {
          const x = i * (bw + gap);
          const hi = (b.itemVolume / max) * (H - 4);
          const hp = (b.pokemonVolume / max) * (H - 4);
          return (
            <g key={b.k} onMouseEnter={() => setPick(i)} onClick={() => setPick(i)} opacity={pick == null || pick === i ? 1 : 0.55}>
              <rect x={x} y={0} width={bw + gap} height={H} fill="transparent" />
              <rect x={x} y={H - hi} width={bw} height={Math.max(hi, 0)} fill={ITEM_COLOR} rx="1.5" />
              <rect x={x} y={H - hi - hp} width={bw} height={Math.max(hp, 0)} fill={POKE_COLOR} rx="1.5" />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex items-center justify-between text-xs text-mute">
        <span>{bucketLabel(data[0].k)}</span>
        <span>{bucketLabel(data[data.length - 1].k)}</span>
      </div>
      <p className="mt-1 min-h-5 text-xs text-mute" aria-live="polite">
        {sel ? (
          <>
            <b className="text-fg">{bucketTitle(sel.k)}</b> · {fmtInt(sel.sales)} vendas · <Money v={sel.volume} moeda={stats.moeda} short /> (itens <Money v={sel.itemVolume} moeda={stats.moeda} short />, Pokémon <Money v={sel.pokemonVolume} moeda={stats.moeda} short />)
          </>
        ) : (
          "Toque numa barra para ver os números daquele período."
        )}
      </p>
      <div className="mt-1 flex gap-4 text-xs text-mute">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: ITEM_COLOR }} /> Itens
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: POKE_COLOR }} /> Pokémon
        </span>
      </div>
    </div>
  );
}

function HoursChart({ hours }: { hours: MarketStats["hours"] }) {
  const byH = new Map(hours.map((h) => [h.h, h.sales]));
  const data = Array.from({ length: 24 }, (_, h) => ({ h, sales: byH.get(h) ?? 0 }));
  const max = Math.max(...data.map((d) => d.sales), 1);
  const top = [...data].sort((a, b) => b.sales - a.sales).slice(0, 3).filter((d) => d.sales > 0);
  if (!top.length) return <p className="text-sm text-mute">Ainda sem vendas neste período.</p>;
  const peak = new Set(top.map((d) => d.h));
  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`Vendas por hora do dia. Maiores picos: ${top.map((d) => `${d.h}h`).join(", ")}`}>
        {data.map((d) => (
          <div key={d.h} className="flex-1 rounded-t-sm" title={`${d.h}h: ${fmtInt(d.sales)} vendas`} style={{ height: `${Math.max((d.sales / max) * 100, 2)}%`, background: peak.has(d.h) ? POKE_COLOR : "#6b5535" }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-mute">
        {[0, 6, 12, 18, 23].map((h) => (
          <span key={h}>{h}h</span>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-mute">
        Mais movimento às <b className="text-fg">{top.map((d) => `${d.h}h`).join(", ")}</b> (horário de Brasília).
      </p>
    </div>
  );
}

function PriceChart({ detail, moeda }: { detail: StatsDetail; moeda: Moeda }) {
  const pts = detail.points.filter((p) => p.avg != null);
  if (pts.length < 2) return <p className="text-sm text-mute">Poucas vendas neste período para traçar o preço.</p>;
  const lo = Math.min(...pts.map((p) => p.min));
  const hi = Math.max(...pts.map((p) => p.max));
  const span = hi - lo || 1;
  const W = 600;
  const H = 150;
  const pad = 6;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const band = `${pts.map((p, i) => `${x(i)},${y(p.max)}`).join(" ")} ${[...pts].reverse().map((p, i) => `${x(pts.length - 1 - i)},${y(p.min)}`).join(" ")}`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Preço médio de ${detail.name}: de ${num(pts[0].avg, moeda)} a ${num(pts[pts.length - 1].avg, moeda)}`}>
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1={pad} x2={W - pad} y1={H * t} y2={H * t} stroke="#3b2b17" strokeWidth="1" />
        ))}
        <polygon points={band} fill={ITEM_COLOR} opacity="0.14" />
        <polyline fill="none" stroke={ITEM_COLOR} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={pts.map((p, i) => `${x(i)},${y(p.avg as number)}`).join(" ")} />
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-mute">
        <span>{bucketLabel(pts[0].k)}</span>
        <span className="tnum">
          faixa {num(lo, moeda)} – {num(hi, moeda)} <span className="text-mute">(linha = preço médio)</span>
        </span>
        <span>{bucketLabel(pts[pts.length - 1].k)}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ peças
function Kpi({ label, value, delta }: { label: string; value: React.ReactNode; delta: number | null }) {
  return (
    <div className="card p-3 sm:p-4">
      <p className="label">{label}</p>
      <p className="tnum mt-1 text-xl font-extrabold sm:text-2xl">{value}</p>
      <Delta value={delta} label="vs. anterior" />
    </div>
  );
}

function Thumb({ g, kind }: { g: StatsGroup; kind: "item" | "pokemon" }) {
  return kind === "pokemon" ? <PokemonSprite looktype={g.look} size={40} /> : <ItemSprite icon={g.icon} size={36} />;
}

function GroupRow({ g, kind, moeda, active, onPick }: { g: StatsGroup; kind: "item" | "pokemon"; moeda: Moeda; active: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-tile focus-visible:bg-tile focus-visible:outline-2 focus-visible:outline-edge ${active ? "bg-tile" : ""}`}
        onClick={onPick}
        aria-pressed={active}
        aria-label={`${g.name}: ver o preço ao longo do tempo`}
      >
        <span className="grid size-10 shrink-0 place-items-center">
          <Thumb g={g} kind={kind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 truncate font-bold">
            {g.shiny && <ShinyMark />}
            <span className="truncate">{g.name}</span>
          </span>
          <span className="tnum block text-xs text-mute">
            {fmtInt(g.sales)} vendas{kind === "item" ? ` · ${fmtShort(g.units)} un.` : ""} · faixa {num(g.min, moeda)}–{num(g.max, moeda)}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <Money v={g.avg} moeda={moeda} short className="font-bold" />
          <span className="block">
            <Delta value={g.change} label="" />
          </span>
        </span>
      </button>
    </li>
  );
}

function Movers({ title, list, moeda, onPick }: { title: string; list: StatsGroup[]; moeda: Moeda; onPick: (g: StatsGroup) => void }) {
  return (
    <section className="card">
      <h3 className="label px-3 pt-3">{title}</h3>
      {list.length === 0 ? (
        <p className="p-3 text-sm text-mute">Nada com vendas suficientes nos dois períodos.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((g) => (
            <GroupRow key={`${g.kind}-${g.name}-${g.shiny}`} g={g} kind={g.kind ?? "item"} moeda={moeda} active={false} onPick={() => onPick(g)} />
          ))}
        </ul>
      )}
    </section>
  );
}

type Pick = { kind: "item" | "pokemon"; g: StatsGroup };

function DetailCard({ pick, moeda, period, onClose }: { pick: Pick; moeda: Moeda; period: StatsPeriod; onClose: () => void }) {
  const d = useAsync(() => marketApi.statsDetail(pick.kind, pick.g.name, pick.g.shiny, moeda, period), [pick.kind, pick.g.name, pick.g.shiny, moeda, period]);
  const sales = d.data?.points.reduce((s, p) => s + p.sales, 0) ?? 0;
  return (
    <section className="card space-y-3 p-3 sm:p-4" aria-label={`Preço de ${pick.g.name}`}>
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center">
          <Thumb g={pick.g} kind={pick.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1 truncate text-base font-extrabold">
            {pick.g.shiny && <ShinyMark />}
            {pick.g.name}
          </h3>
          <p className="tnum text-xs text-mute">
            {fmtInt(sales || pick.g.sales)} vendas · média <Money v={pick.g.avg} moeda={moeda} short />
          </p>
        </div>
        <button className="btn" onClick={onClose} aria-label="Fechar o gráfico de preço">
          Fechar
        </button>
      </div>
      {d.loading && !d.data ? <Loading /> : d.error && !d.data ? <ErrorBox error={d.error} onRetry={d.reload} /> : d.data ? <PriceChart detail={d.data} moeda={moeda} /> : null}
    </section>
  );
}

function coverageNote(c: MarketStats["coverage"], days: number, now: number) {
  if (!c.first) return "Ainda não há vendas guardadas. O painel começa a coletar sozinho quando uma conta está online.";
  const have = (now - c.first) / 86_400_000;
  const since = new Date(c.first).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return have < days
    ? `Coletando desde ${since} (${fmtInt(c.count)} vendas). Este período ainda não está completo e fica mais preciso a cada dia.`
    : `${fmtInt(c.count)} vendas do servidor guardadas desde ${since}.`;
}

// ------------------------------------------------------------------ aba
/** Aba Análise: o que o servidor mais vende, preços, altas e quedas e os horários de pico. */
export function StatsTab() {
  const [period, setPeriod] = useState<StatsPeriod>("7d");
  const [moeda, setMoeda] = useState<Moeda>("gold");
  const [view, setView] = useState<"item" | "pokemon">("item");
  const [pick, setPick] = useState<Pick | null>(null);
  const res = useAsync(() => marketApi.stats(moeda, period), [moeda, period], { every: 60000 });
  const s = res.data;
  const list = s ? (view === "item" ? s.items : s.pokemon) : [];

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Seg label="Período" value={period} onChange={setPeriod} options={PERIODS} />
        <CurrencyToggle value={moeda} onChange={(m) => m !== "all" && setMoeda(m)} />
      </div>

      {res.loading && !s ? (
        <Loading />
      ) : res.error && !s ? (
        <ErrorBox error={res.error} onRetry={res.reload} />
      ) : s ? (
        <>
          <p className="text-xs text-mute">{coverageNote(s.coverage, s.days, s.now)}</p>

          {s.totals.sales === 0 ? (
            <p className="card p-8 text-center text-sm text-mute">Nenhuma venda em {moeda === "orb" ? "Gemas" : "Gold"} neste período.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3 sm:gap-3">
                <Kpi label="Vendas" value={fmtInt(s.totals.sales)} delta={pct(s.totals.sales, s.totals.prevSales)} />
                <Kpi label="Valor movimentado" value={<Money v={s.totals.volume} moeda={moeda} short />} delta={pct(s.totals.volume, s.totals.prevVolume)} />
                <Kpi label="Venda média" value={<Money v={Math.round(s.totals.volume / s.totals.sales)} moeda={moeda} short />} delta={pct(s.totals.volume / s.totals.sales, s.totals.prevSales ? s.totals.prevVolume / s.totals.prevSales : 0)} />
              </div>

              <div className="grid gap-3 sm:gap-4 lg:grid-cols-[3fr_2fr]">
                <section className="card p-3 sm:p-4">
                  <h3 className="label mb-2">Valor vendido {s.hourly ? "por hora" : "por dia"}</h3>
                  <VolumeChart stats={s} />
                </section>
                <section className="card p-3 sm:p-4">
                  <h3 className="label mb-2">Horários de pico</h3>
                  <HoursChart hours={s.hours} />
                </section>
              </div>

              <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
                <Movers title="Preço subiu" list={s.up} moeda={moeda} onPick={(g) => setPick({ kind: g.kind ?? "item", g })} />
                <Movers title="Preço caiu" list={s.down} moeda={moeda} onPick={(g) => setPick({ kind: g.kind ?? "item", g })} />
              </div>

              {pick && <DetailCard pick={pick} moeda={moeda} period={period} onClose={() => setPick(null)} />}

              <div className="space-y-2">
                <Seg
                  label="Ranking"
                  value={view}
                  onChange={setView}
                  options={[
                    { id: "item", label: "Itens por valor" },
                    { id: "pokemon", label: "Pokémon por vendas" },
                  ]}
                />
                {list.length === 0 ? (
                  <p className="card p-6 text-center text-sm text-mute">Sem vendas deste tipo no período.</p>
                ) : (
                  <ul className="card divide-y divide-line">
                    {list.map((g) => (
                      <GroupRow key={`${g.name}-${g.shiny}`} g={g} kind={view} moeda={moeda} active={pick?.g.name === g.name && pick.g.shiny === g.shiny && pick.kind === view} onPick={() => setPick({ kind: view, g })} />
                    ))}
                  </ul>
                )}
                <p className="text-xs text-mute">Toque num item ou Pokémon para ver como o preço andou. A variação compara o preço médio com o período anterior do mesmo tamanho e só aparece com 3 vendas ou mais nos dois.</p>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

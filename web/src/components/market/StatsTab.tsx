import { memo, useMemo, useState } from "react";
import { ItemSprite, PokemonSprite, ShinyMark } from "@/components/Sprites";
import { type MarketStats, type Moeda, type StatsBucket, type StatsDetail, type StatsGroup, type StatsPeriod, marketApi } from "@/lib/market";
import { fmtInt, fmtShort } from "@/lib/utils";
import { zmoveName } from "@/lib/zmove";
import { CurrencyToggle, ErrorBox, Loading, Money, Seg, useAsync } from "./shared";

const PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: "24h", label: "24 horas" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
];
const BLUE = "#5cc8e8";
const GOLD = "#f3c04a";
const GRID = "#3b2b17";
const SHOW_FIRST = 10;

// ------------------------------------------------------------------ formatação
const pct = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
const fmtPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 })}%`;
/** Preço curto; Gemas baixas (10, 2,5) mostram casas decimais em vez de arredondar para zero. */
const price = (n: number | null | undefined) => (n == null ? "—" : n < 100 ? n.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : fmtShort(n));
const dayLabel = (k: string) => (k.length > 10 ? `${k.slice(11, 13)}h` : `${k.slice(8, 10)}/${k.slice(5, 7)}`);
const dayTitle = (k: string) => (k.length > 10 ? `${k.slice(8, 10)}/${k.slice(5, 7)} às ${k.slice(11, 13)}h` : `${k.slice(8, 10)}/${k.slice(5, 7)}`);
const since = (ms: number) => new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/** Variação: verde sobe, vermelho cai. Sem número, mostra o motivo em vez de um traço mudo. */
function Delta({ value, none = "sem base", suffix = "" }: { value: number | null; none?: string; suffix?: string }) {
  if (value == null) return <span className="text-xs text-mute">{none}</span>;
  const up = value > 0.05;
  const down = value < -0.05;
  return (
    <span className={`tnum text-xs font-bold ${up ? "text-poke-green" : down ? "text-poke-red" : "text-mute"}`}>
      {up ? "▲ " : down ? "▼ " : ""}
      {fmtPct(value)}
      {suffix && <span className="font-medium text-mute"> {suffix}</span>}
    </span>
  );
}

/** Mini gráfico de linha (sem eixos) para ver a direção do preço de relance. */
function Spark({ values, tone }: { values: number[]; tone: "up" | "down" | "flat" }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo || 1;
  const W = 64;
  const H = 22;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - 2 - ((v - lo) / span) * (H - 4)}`).join(" ");
  const color = tone === "up" ? "#6fd47c" : tone === "down" ? "#ef6b5b" : "#b39a6e";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="shrink-0" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------------ gráficos (SVG simples, sem biblioteca)
/** Completa os baldes sem venda com zero (hora a hora nas 24 h). Chaves em horário de Brasília. */
function fill(series: StatsBucket[], now: number): StatsBucket[] {
  const byKey = new Map(series.map((b) => [b.k, b]));
  const out: StatsBucket[] = [];
  for (let i = 23; i >= 0; i--) {
    const iso = new Date(now - 3 * 3_600_000 - i * 3_600_000).toISOString();
    const k = `${iso.slice(0, 10)} ${iso.slice(11, 13)}:00`;
    out.push(byKey.get(k) ?? { k, sales: 0, volume: 0, itemVolume: 0, pokemonVolume: 0 });
  }
  return out;
}

function ChartCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="card p-3 sm:p-4">
      <h3 className="text-base font-extrabold">{title}</h3>
      <p className="mb-3 text-xs text-mute">{hint}</p>
      {children}
    </section>
  );
}

/** "03h às 04h" (e o dia, quando não é hoje) a partir da chave "AAAA-MM-DD HH:00" em horário de Brasília. */
const hourRange = (k: string) => {
  const h = Number(k.slice(11, 13));
  return `${k.slice(8, 10)}/${k.slice(5, 7)}, ${String(h).padStart(2, "0")}h às ${String((h + 1) % 24).padStart(2, "0")}h`;
};

/** Valor vendido a cada hora nas últimas 24 horas. Toque numa barra para ver os números daquela hora. */
function VolumeChart({ stats }: { stats: MarketStats }) {
  const data = useMemo(() => fill(stats.series, stats.now), [stats.series, stats.now]);
  const [pick, setPick] = useState<number | null>(null);
  const unit = stats.moeda === "orb" ? "Gemas" : "Gold";
  const total = data.reduce((s, b) => s + b.volume, 0);
  const sales = data.reduce((s, b) => s + b.sales, 0);
  const max = Math.max(...data.map((b) => b.volume), 1);
  const best = data.reduce((a, b) => (b.volume > a.volume ? b : a));
  const startedAt = stats.coverage.first;
  const collectedFor = startedAt ? stats.now - startedAt : 0;
  const partial = collectedFor > 0 && collectedFor < 24 * 3_600_000;
  const hourStart = (k: string) => Date.parse(`${k.replace(" ", "T")}:00-03:00`);
  const shown = pick != null ? data[pick] : best;
  const labelAt = new Set([0, 6, 12, 18, 23]);
  if (!total) return <p className="text-sm text-mute">Nenhuma venda em {unit} nas últimas 24 horas.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Nas últimas 24 horas foram vendidos <b className="text-poke-gold"><Money v={total} moeda={stats.moeda} short /></b> em <b className="tnum">{fmtInt(sales)}</b> vendas.
        <span className="text-mute"> A hora mais forte foi {String(Number(best.k.slice(11, 13))).padStart(2, "0")}h.</span>
      </p>

      <div>
        <div className="flex gap-1.5">
          {/* Escala: o maior valor e a metade dele, numa coluna própria para não ficar sob as barras */}
          <div className="tnum relative w-9 shrink-0 text-right text-[10px] leading-none text-mute" aria-hidden>
            <span className="absolute right-0 top-0">{fmtShort(max)}</span>
            <span className="absolute right-0 top-1/2 -translate-y-1/2">{fmtShort(max / 2)}</span>
          </div>
          <div className="relative min-w-0 flex-1">
            {[0, 50, 100].map((p) => (
              <div key={p} className="pointer-events-none absolute inset-x-0 border-t border-line" style={{ top: `${p}%` }} />
            ))}
            <div className="relative flex h-40 items-stretch gap-[3px] sm:h-48" role="group" aria-label={`Valor vendido por hora em ${unit}`}>
              {data.map((b, i) => {
                const empty = startedAt != null && hourStart(b.k) + 3_600_000 <= startedAt;   // antes de o painel começar a coletar
                return (
                  <button
                    key={b.k}
                    type="button"
                    onClick={() => setPick(pick === i ? null : i)}
                    onMouseEnter={() => setPick(i)}
                    onFocus={() => setPick(i)}
                    aria-label={`${hourRange(b.k)}: ${fmtInt(b.sales)} vendas, ${fmtInt(b.volume)} ${unit}`}
                    aria-pressed={pick === i}
                    className="relative flex min-w-0 flex-1 flex-col-reverse rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-edge"
                  >
                    {empty ? (
                      <span className="block w-full rounded-sm bg-line/60" style={{ height: 3 }} title="Antes de o painel começar a coletar" />
                    ) : (
                      <>
                        <span className="block w-full" style={{ height: `${(b.itemVolume / max) * 100}%`, background: BLUE, opacity: pick != null && pick !== i ? 0.45 : 1 }} />
                        <span className="block w-full rounded-t-sm" style={{ height: `${(b.pokemonVolume / max) * 100}%`, background: GOLD, opacity: pick != null && pick !== i ? 0.45 : 1 }} />
                        {b.volume === 0 && <span className="block w-full rounded-sm bg-line" style={{ height: 3 }} />}
                      </>
                    )}
                    {pick === i && <span className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-fg/80" aria-hidden />}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 flex gap-[3px] text-[11px] text-mute" aria-hidden>
              {data.map((b, i) => (
                <span key={b.k} className="relative min-w-0 flex-1">
                  {labelAt.has(i) && <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: i === 0 ? "30%" : i === 23 ? "70%" : "50%" }}>{b.k.slice(11, 13)}h</span>}
                  &nbsp;
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-tile px-3 py-2.5" aria-live="polite">
        <p className="text-xs font-semibold text-mute">{pick != null ? hourRange(shown.k) : `Hora mais forte: ${hourRange(shown.k)}`}</p>
        <p className="tnum mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
          <b className="text-base"><Money v={shown.volume} moeda={stats.moeda} short /></b>
          <span className="text-mute">{fmtInt(shown.sales)} vendas</span>
        </p>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: BLUE }} /> Itens <Money v={shown.itemVolume} moeda={stats.moeda} short />
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: GOLD }} /> Pokémon <Money v={shown.pokemonVolume} moeda={stats.moeda} short />
          </span>
        </p>
        {pick == null && <p className="mt-1.5 text-[11px] text-mute">Toque ou passe o mouse numa barra para ver outra hora.</p>}
      </div>

      {partial && (
        <p className="rounded-lg bg-tile px-2.5 py-2 text-xs text-mute">
          O painel começou a coletar há <b className="text-fg">{spanLabel(collectedFor)}</b>. As horas anteriores aparecem como um traço fino porque ainda não foram coletadas.
        </p>
      )}
    </div>
  );
}

/** Linha de preços em geral: 100 = o começo do período. */
function IndexChart({ index }: { index: NonNullable<MarketStats["index"]> }) {
  const pts = index.points;
  const [pick, setPick] = useState<number | null>(null);
  const vals = pts.map((p) => p.index);
  const rawLo = Math.min(...vals, 100);
  const rawHi = Math.max(...vals, 100);
  const margin = (rawHi - rawLo || 1) * 0.15;
  const lo = rawLo - margin;
  const span = rawHi + margin - lo;
  const W = 600;
  const H = 140;
  const pad = 8;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const line = pts.map((p, i) => `${x(i)},${y(p.index)}`).join(" ");
  const sel = pick != null ? pts[pick] : null;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-manipulation" role="img" aria-label={`Preços dos itens: ${fmtPct(index.change)} no período`}>
        <line x1={pad} x2={W - pad} y1={y(100)} y2={y(100)} stroke="#b39a6e" strokeWidth="1" strokeDasharray="4 4" />
        <polygon points={`${x(0)},${H - pad} ${line} ${x(pts.length - 1)},${H - pad}`} fill={GOLD} opacity="0.1" />
        <polyline points={line} fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={p.day} onMouseEnter={() => setPick(i)} onClick={() => setPick(i)}>
            <rect x={x(i) - (W - pad * 2) / (pts.length - 1) / 2} y={0} width={(W - pad * 2) / (pts.length - 1)} height={H} fill="transparent" />
            {pick === i && <circle cx={x(i)} cy={y(p.index)} r="5" fill={GOLD} stroke="#0e0a06" strokeWidth="2" />}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-mute">
        <span>{dayLabel(pts[0].day)}</span>
        <span>{dayLabel(pts[pts.length - 1].day)}</span>
      </div>
      <p className="mt-2 min-h-8 text-xs text-mute" aria-live="polite">
        {sel ? (
          <>
            <b className="text-fg">{dayTitle(sel.day)}</b> · índice <b className="tnum text-fg">{sel.index.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</b> ({fmtPct(sel.index - 100)} contra o começo)
          </>
        ) : (
          "Linha tracejada = preços do primeiro dia. Toque na linha para ver cada dia."
        )}
      </p>
    </div>
  );
}

const PARTS = [
  { id: "madrugada", label: "Madrugada", range: "0h–6h", from: 0, to: 6 },
  { id: "manha", label: "Manhã", range: "6h–12h", from: 6, to: 12 },
  { id: "tarde", label: "Tarde", range: "12h–18h", from: 12, to: 18 },
  { id: "noite", label: "Noite", range: "18h–24h", from: 18, to: 24 },
] as const;
const hourSpan = (h: number) => `${h}h às ${(h + 1) % 24}h`;
/** "5 horas" ou "3 dias": há quanto tempo o painel coleta as vendas desta tela. */
const spanLabel = (ms: number) => {
  const h = Math.max(1, Math.round(ms / 3_600_000));
  return h < 48 ? `${h} ${h === 1 ? "hora" : "horas"}` : `${Math.round(h / 24)} dias`;
};

/** Em que horas do dia (horário de Brasília) o mercado vende mais. Toque numa barra para ver o número exato. */
function HoursChart({ hours, from, now }: { hours: MarketStats["hours"]; from: number | null; now: number }) {
  const [pick, setPick] = useState<number | null>(null);
  const byH = new Map(hours.map((h) => [h.h, h.sales]));
  const data = Array.from({ length: 24 }, (_, h) => ({ h, sales: byH.get(h) ?? 0 }));
  const total = data.reduce((s, d) => s + d.sales, 0);
  if (!total) return <p className="text-sm text-mute">Ainda não há vendas coletadas neste período. O painel coleta sozinho enquanto uma conta estiver online.</p>;
  const max = Math.max(...data.map((d) => d.sales), 1);
  const top = [...data].sort((a, b) => b.sales - a.sales).slice(0, 3).filter((d) => d.sales > 0);
  const peak = new Set(top.map((d) => d.h));
  const share = (n: number) => Math.round((n / total) * 100);
  const parts = PARTS.map((p) => ({ ...p, sales: data.filter((d) => d.h >= p.from && d.h < p.to).reduce((s, d) => s + d.sales, 0) }));
  const bestPart = parts.reduce((a, b) => (b.sales > a.sales ? b : a));
  const covered = from ? now - from : 0;
  const partial = covered > 0 && covered < 3 * 86_400_000;
  const sel = pick != null ? data[pick] : null;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        O pico de vendas é às <b className="text-poke-gold">{top[0].h}h</b>.
        {top.length > 1 && <span className="text-mute"> Depois vêm {top.slice(1).map((d) => `${d.h}h`).join(" e ")}.</span>}
      </p>

      <div>
        <div className="flex h-28 items-stretch gap-[3px]" role="group" aria-label="Vendas por hora do dia">
          {data.map((d) => (
            <button
              key={d.h}
              type="button"
              onClick={() => setPick(pick === d.h ? null : d.h)}
              onMouseEnter={() => setPick(d.h)}
              onFocus={() => setPick(d.h)}
              aria-label={`${hourSpan(d.h)}: ${fmtInt(d.sales)} vendas`}
              aria-pressed={pick === d.h}
              className="group relative flex min-w-0 flex-1 items-end rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-edge"
            >
              <span
                className="block w-full rounded-t-sm transition-opacity"
                style={{ height: `${d.sales ? Math.max((d.sales / max) * 100, 6) : 3}%`, background: pick === d.h ? "#fff3c4" : peak.has(d.h) ? GOLD : d.sales ? "#8a6d3f" : "#3b2b17", opacity: pick != null && pick !== d.h ? 0.55 : 1 }}
              />
            </button>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-mute" aria-hidden>
          {[0, 6, 12, 18].map((h) => (
            <span key={h}>{h}h</span>
          ))}
          <span>24h</span>
        </div>
        <p className="mt-1.5 min-h-5 text-xs" aria-live="polite">
          {sel ? (
            <>
              <b className="text-fg">{hourSpan(sel.h)}</b> <span className="text-mute">· {fmtInt(sel.sales)} vendas ({share(sel.sales)}% do dia)</span>
            </>
          ) : (
            <span className="text-mute">Toque numa barra para ver as vendas daquela hora. Barras douradas são os 3 maiores picos.</span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-1.5" aria-label="Vendas por período do dia">
        {parts.map((p) => (
          <div key={p.id} className={`rounded-lg border px-1.5 py-1.5 text-center ${p.id === bestPart.id ? "border-edge/70 bg-tile" : "border-line"}`}>
            <p className="tnum text-base font-extrabold leading-none">{share(p.sales)}%</p>
            <p className="mt-1 text-[11px] font-semibold leading-tight">{p.label}</p>
            <p className="text-[10px] leading-tight text-mute">{p.range}</p>
          </div>
        ))}
      </div>

      {partial && (
        <p className="rounded-lg bg-tile px-2.5 py-2 text-xs text-mute">
          O painel começou a coletar há <b className="text-fg">{spanLabel(covered)}</b>, então estes horários ainda são parciais. Eles ficam mais confiáveis a cada dia.
        </p>
      )}
    </div>
  );
}

/** Preço de um item ao longo do tempo: linha = preço típico, faixa clara = onde a maioria das vendas ficou. */
function PriceChart({ detail }: { detail: StatsDetail }) {
  const pts = detail.points.filter((p) => p.avg != null);
  const [pick, setPick] = useState<number | null>(null);
  if (pts.length < 2) return <p className="text-sm text-mute">Poucas vendas neste período para traçar o preço.</p>;
  const lo = Math.min(...pts.map((p) => p.min));
  const hi = Math.max(...pts.map((p) => p.max));
  const span = hi - lo || 1;
  const W = 600;
  const H = 140;
  const pad = 8;
  const step = (W - pad * 2) / (pts.length - 1);
  const x = (i: number) => pad + i * step;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const band = `${pts.map((p, i) => `${x(i)},${y(p.max)}`).join(" ")} ${[...pts].reverse().map((p, i) => `${x(pts.length - 1 - i)},${y(p.min)}`).join(" ")}`;
  const sel = pick != null ? pts[pick] : null;
  const kind = detail.source === "hub" ? "mediana" : "média";
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-manipulation" role="img" aria-label={`Preço de ${zmoveName(detail.name)}: de ${price(pts[0].avg)} a ${price(pts[pts.length - 1].avg)}`}>
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1={pad} x2={W - pad} y1={H * t} y2={H * t} stroke={GRID} strokeWidth="1" />
        ))}
        <polygon points={band} fill={BLUE} opacity="0.16" />
        <polyline fill="none" stroke={BLUE} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={pts.map((p, i) => `${x(i)},${y(p.avg as number)}`).join(" ")} />
        {pts.map((p, i) => (
          <g key={p.k} onMouseEnter={() => setPick(i)} onClick={() => setPick(i)}>
            <rect x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent" />
            {pick === i && <circle cx={x(i)} cy={y(p.avg as number)} r="5" fill={BLUE} stroke="#0e0a06" strokeWidth="2" />}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-mute">
        <span>{dayLabel(pts[0].k)}</span>
        <span>{dayLabel(pts[pts.length - 1].k)}</span>
      </div>
      <p className="mt-2 min-h-8 text-xs text-mute" aria-live="polite">
        {sel ? (
          <>
            <b className="text-fg">{dayTitle(sel.k)}</b> · {kind} <b className="tnum text-fg">{price(sel.avg)}</b> · faixa {price(sel.min)}–{price(sel.max)} · {fmtInt(sel.sales)} vendas
          </>
        ) : (
          `Linha = ${kind} por unidade. A faixa clara mostra onde ficou a maioria das vendas.`
        )}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ resumo e listas
function Stat({ label, children, delta }: { label: string; children: React.ReactNode; delta: React.ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-5 sm:py-4">
      <p className="text-xs font-semibold leading-tight text-mute sm:text-sm">{label}</p>
      <p className="tnum mt-1 truncate text-xl font-extrabold sm:text-3xl">{children}</p>
      <div className="mt-0.5">{delta}</div>
    </div>
  );
}

function Thumb({ g }: { g: StatsGroup }) {
  return g.kind === "pokemon" ? <PokemonSprite looktype={g.look} species={g.species} size={38} /> : <ItemSprite icon={g.icon} size={34} />;
}
const tone = (c: number | null): "up" | "down" | "flat" => (c == null ? "flat" : c > 0.05 ? "up" : c < -0.05 ? "down" : "flat");

const GroupRow = memo(function GroupRow({ g, moeda, open, onToggle, trailing = "price", children }: { g: StatsGroup; moeda: Moeda; open: boolean; onToggle: () => void; trailing?: "price" | "move"; children?: React.ReactNode }) {
  return (
    <li>
      <button
        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-tile focus-visible:bg-tile focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-edge ${open ? "bg-tile" : ""}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${zmoveName(g.name)}: ${open ? "esconder" : "ver"} o preço ao longo do tempo`}
      >
        <span className="grid size-10 shrink-0 place-items-center">
          <Thumb g={g} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 font-bold">
            {g.shiny && <ShinyMark />}
            <span className="truncate">{zmoveName(g.name)}</span>
          </span>
          <span className="tnum block truncate text-xs text-mute">
            {trailing === "move" ? `${fmtInt(g.sales)} vendas` : g.low != null && g.high != null ? `${fmtInt(g.sales)} vendas · faixa ${price(g.low)}–${price(g.high)}` : `${fmtInt(g.sales)} vendas`}
          </span>
        </span>
        {trailing === "move" && g.spark.length > 1 && <Spark values={g.spark} tone={tone(g.change)} />}
        <span className="shrink-0 text-right">
          <Money v={g.typical} moeda={moeda} short className="font-bold" />
          <span className="block">
            <Delta value={g.change} none="" />
          </span>
        </span>
      </button>
      {open && <div className="border-t border-line bg-tile px-3 pb-3 pt-3">{children}</div>}
    </li>
  );
});

const keyOf = (g: StatsGroup) => `${g.kind}|${g.name}|${g.shiny ? 1 : 0}`;

function Detail({ g, moeda, period }: { g: StatsGroup; moeda: Moeda; period: StatsPeriod }) {
  const d = useAsync(() => marketApi.statsDetail(g.kind, g.name, g.shiny, moeda, period), [g.kind, g.name, g.shiny, moeda, period]);
  if (d.loading && !d.data) return <Loading />;
  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  return d.data ? <PriceChart detail={d.data} /> : null;
}

function Highlights({ title, list, moeda, period, openKey, onToggle }: { title: string; list: StatsGroup[]; moeda: Moeda; period: StatsPeriod; openKey: string | null; onToggle: (k: string) => void }) {
  return (
    <section className="card overflow-hidden">
      <h3 className="px-3 pt-3 text-base font-extrabold sm:px-4">{title}</h3>
      {list.length === 0 ? (
        <p className="p-4 text-sm text-mute">Nada com vendas suficientes para comparar.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line border-t border-line">
          {list.map((g) => {
            const k = `up|${keyOf(g)}|${title}`;
            return (
              <GroupRow key={k} g={g} moeda={moeda} trailing="move" open={openKey === k} onToggle={() => onToggle(k)}>
                {openKey === k && <Detail g={g} moeda={moeda} period={period} />}
              </GroupRow>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Ranking({ s, openKey, onToggle }: { s: MarketStats; openKey: string | null; onToggle: (k: string) => void }) {
  const [kind, setKind] = useState<"all" | "item" | "pokemon">("all");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return s.groups.filter((g) => (kind === "all" || g.kind === kind) && (!n || g.name.toLowerCase().includes(n) || zmoveName(g.name).toLowerCase().includes(n)));
  }, [s.groups, kind, q]);
  const shown = all || q ? list : list.slice(0, SHOW_FIRST);
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-extrabold">Mais vendidos</h3>
          <p className="text-xs text-mute">Do que mais saiu ao que saiu menos. Toque para ver o preço ao longo do tempo.</p>
        </div>
        <Seg
          label="Mostrar"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setAll(false);
          }}
          options={[
            { id: "all", label: "Tudo" },
            { id: "item", label: "Itens" },
            { id: "pokemon", label: "Pokémon" },
          ]}
        />
      </div>
      <input className="field w-full" type="search" placeholder="Buscar item ou Pokémon" value={q} onChange={(e) => setQ(e.target.value)} maxLength={40} aria-label="Buscar item ou Pokémon" />
      {shown.length === 0 ? (
        <p className="card p-6 text-center text-sm text-mute">{q ? "Nada com esse nome neste período." : "Sem vendas deste tipo no período."}</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {shown.map((g) => {
            const k = `rank|${keyOf(g)}`;
            return (
              <GroupRow key={k} g={g} moeda={s.moeda} open={openKey === k} onToggle={() => onToggle(k)}>
                {openKey === k && <Detail g={g} moeda={s.moeda} period={s.period} />}
              </GroupRow>
            );
          })}
        </ul>
      )}
      {!q && list.length > SHOW_FIRST && (
        <button className="btn w-full" onClick={() => setAll((v) => !v)}>
          {all ? "Mostrar menos" : `Ver todos (${list.length})`}
        </button>
      )}
    </section>
  );
}

function SourceNote({ s }: { s: MarketStats }) {
  const from = s.coverage.first ? since(s.coverage.first) : null;
  if (s.hubDown)
    return (
      <p className="rounded-xl border border-poke-red/40 bg-poke-red/10 px-3 py-2 text-xs text-fg">
        O site de histórico (pokeidleguide.io) não respondeu, então esta tela mostra só o que o painel coletou{from ? ` desde ${from}` : ""}. Tentamos de novo a cada minuto.
      </p>
    );
  if (s.source === "hub")
    return (
      <p className="text-xs text-mute">
        Histórico do <b className="text-fg">pokeidleguide.io</b>
        {from ? `, com ${fmtInt(s.coverage.count)} vendas guardadas desde ${from}` : ""}. As 24 horas vêm do seu painel.
      </p>
    );
  return (
    <p className="text-xs text-mute">
      {from ? `Vendas coletadas ao vivo pelo seu painel desde ${from} (${fmtInt(s.coverage.count)} no total).` : "Ainda não há vendas guardadas: o painel começa a coletar sozinho quando uma conta está online."}
    </p>
  );
}

// ------------------------------------------------------------------ aba
/** Aba Análise: quanto o servidor vende, o que ficou mais caro ou barato, horários de pico e o preço de cada coisa. */
export function StatsTab() {
  const [period, setPeriod] = useState<StatsPeriod>("7d");
  const [moeda, setMoeda] = useState<Moeda>("gold");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const res = useAsync(() => marketApi.stats(moeda, period), [moeda, period], { every: 60000 });
  const s = res.data;
  const toggle = (k: string) => setOpenKey((cur) => (cur === k ? null : k));
  const unit = moeda === "orb" ? "Gemas" : "Gold";
  const third = s?.index
    ? { label: "Preços dos itens", value: fmtPct(s.index.change), delta: <span className="text-xs text-mute">no período</span> }
    : s && s.totals.sales
      ? { label: "Venda média", value: <Money v={Math.round(s.totals.volume / s.totals.sales)} moeda={moeda} short />, delta: <Delta value={pct(s.totals.volume / s.totals.sales, s.totals.prevSales ? s.totals.prevVolume / s.totals.prevSales : 0)} /> }
      : null;

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          label="Período"
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setOpenKey(null);
          }}
          options={PERIODS}
        />
        <CurrencyToggle
          value={moeda}
          onChange={(m) => {
            if (m !== "all") {
              setMoeda(m);
              setOpenKey(null);
            }
          }}
        />
      </div>

      {res.loading && !s ? (
        <Loading />
      ) : res.error && !s ? (
        <ErrorBox error={res.error} onRetry={res.reload} />
      ) : s ? (
        <>
          <SourceNote s={s} />

          {s.totals.sales === 0 ? (
            <p className="card p-8 text-center text-sm text-mute">Nenhuma venda em {unit} neste período.</p>
          ) : (
            <>
              <section className="card grid grid-cols-3 divide-x divide-line" aria-label="Resumo do período">
                <Stat label="Vendas feitas" delta={<Delta value={pct(s.totals.sales, s.totals.prevSales)} />}>
                  {fmtInt(s.totals.sales)}
                </Stat>
                <Stat label={`${unit} vendido`} delta={<Delta value={pct(s.totals.volume, s.totals.prevVolume)} />}>
                  <Money v={s.totals.volume} moeda={moeda} short />
                </Stat>
                {third && (
                  <Stat label={third.label} delta={third.delta}>
                    {third.value}
                  </Stat>
                )}
              </section>
              {s.totals.prevSales > 0 && <p className="-mt-1 px-1 text-xs text-mute">As setas comparam com o período anterior do mesmo tamanho.</p>}

              <div className={`grid gap-3 sm:gap-4 ${(s.source === "local" && s.hourly) || s.index ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
                {s.source === "local" && s.hourly ? (
                  <ChartCard title="Quanto foi vendido" hint={`Valor em ${unit} vendido a cada hora (horário de Brasília).`}>
                    <VolumeChart stats={s} />
                  </ChartCard>
                ) : s.index ? (
                  <ChartCard title="Preços dos itens" hint="Como o preço dos itens andou em relação ao primeiro dia. Acima de 100, ficou mais caro; abaixo, mais barato.">
                    <IndexChart index={s.index} />
                  </ChartCard>
                ) : null}
                <ChartCard title="Horários de pico" hint="Em que horas do dia (horário de Brasília) o mercado mais vende.">
                  <HoursChart hours={s.hours} from={s.hoursFrom} now={s.now} />
                </ChartCard>
              </div>

              {(s.up.length > 0 || s.down.length > 0) && (
                <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
                  <Highlights title="Ficaram mais caros" list={s.up} moeda={moeda} period={period} openKey={openKey} onToggle={toggle} />
                  <Highlights title="Ficaram mais baratos" list={s.down} moeda={moeda} period={period} openKey={openKey} onToggle={toggle} />
                </div>
              )}

              <Ranking s={s} openKey={openKey} onToggle={toggle} />

              <details className="card px-3 py-2.5 text-sm text-mute sm:px-4">
                <summary className="cursor-pointer font-semibold text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-edge">Como ler esta tela</summary>
                <ul className="mt-2 list-disc space-y-1.5 pl-5">
                  <li>
                    <b className="text-fg">Preço típico</b> é a mediana: metade das vendas foi mais barata e metade mais cara. Ela não se deixa enganar por uma venda fora do comum.
                  </li>
                  <li>
                    <b className="text-fg">Faixa</b> é onde ficou a maior parte das vendas (do quarto mais barato ao quarto mais caro).
                  </li>
                  <li>
                    <b className="text-fg">Mais caros / mais baratos</b> comparam com o começo do período e só entram coisas com vendas suficientes.
                  </li>
                  <li>
                    <b className="text-fg">24 horas</b> vem do seu painel, hora a hora. <b className="text-fg">7 e 30 dias</b> vêm do pokeidleguide.io, um site da comunidade que guarda o histórico de vendas.
                  </li>
                </ul>
              </details>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { HuntRow, type HuntCalc } from "@/components/HuntRow";
import { PokemonSprite } from "@/components/Sprites";
import type { Creature, Hunt } from "@/lib/actions";
import { type BestHunts, type HuntLine, type HuntOrder, lineMetric, rankLines } from "@/lib/huntAdvisor";
import { fmtInt, fmtShort } from "@/lib/utils";

const ORDERS: { id: HuntOrder; label: string }[] = [
  { id: "xp", label: "XP/h" },
  { id: "ouro", label: "Ouro/h" },
];
const SHOWN = 3;
const MAX = 10;
const HUB = "https://pokeidle-gg.pages.dev/#hunt";

const per = (n: number) => fmtShort(Math.round(n));

function calcOf(l: HuntLine, rank: number, order: HuntOrder): HuntCalc {
  const other = order === "ouro" ? `XP ${per(l.xpPokemonH)}/h` : `Ouro ${per(l.ouroH)}/h`;
  return {
    rank,
    main: per(lineMetric(l, order)),
    unit: order === "ouro" ? "ouro/h" : "XP/h",
    sub: `${fmtInt(Math.round(l.kph))} abates/h · ${other}`,
    risk: l.umHit ? "one" : l.mortesH,
  };
}

/** Melhor hunt para o Pokémon equipado agora (motor do PokéIdle Hub), com as mesmas linhas da lista de áreas. */
export function BestHuntCard({
  nick, order, onOrder, best, loading, error, onRetry, online, level, hunts, creatures,
  currentSlug, pendingSlug, focusSlug, busy, canHunt, onFocus, onHunt,
}: {
  nick: string;
  order: HuntOrder;
  onOrder: (o: HuntOrder) => void;
  best: BestHunts | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  online: boolean;
  level: number;
  hunts: Hunt[];
  creatures: Record<string, Creature> | null;
  currentSlug: string | null;
  pendingSlug: string | null;
  focusSlug: string | null;
  busy: boolean;
  canHunt: boolean;
  onFocus: (slug: string) => void;
  onHunt: (h: Hunt) => void;
}) {
  const [more, setMore] = useState(false);
  const bySlug = useMemo(() => new Map(hunts.map((h) => [h.slug, h])), [hunts]);
  // Só as hunts que a conta enxerga no mapa (as que dá para mandar caçar).
  const ranked = useMemo(() => rankLines(best?.lines, order).filter((l) => bySlug.has(l.slug)), [best, order, bySlug]);
  const shown = ranked.slice(0, more ? MAX : SHOWN);
  const sheet = best?.sheet;
  const cur = best?.lines.find((l) => l.slug === currentSlug);
  const top = ranked[0];
  const curMetric = cur ? lineMetric(cur, order) : 0;
  const gain = top && curMetric > 0 && top.slug !== cur?.slug ? lineMetric(top, order) / curMetric - 1 : 0;
  const unit = order === "ouro" ? "ouro/h" : "XP/h";

  return (
    <section className="card space-y-2.5 p-3" aria-labelledby="best-hunt">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-edge/70" style={{ background: "radial-gradient(circle at 50% 35%, #4a3519, #1a120a 75%)" }}>
          {sheet ? <PokemonSprite looktype={sheet.looktype} size={40} /> : <Loader2 className="size-5 animate-spin text-mute motion-reduce:animate-none" aria-hidden />}
        </span>
        <div className="min-w-[11rem] flex-1">
          <h2 id="best-hunt" className="font-extrabold leading-tight">
            Melhor hunt para {sheet ? sheet.nome : "o Pokémon equipado"}
          </h2>
          <p className="mt-0.5 text-xs text-mute">{sheet ? `Nv ${fmtInt(sheet.level)} · conta ${nick}` : `Conta ${nick}`}</p>
        </div>
        <div className="flex w-full gap-1.5 sm:w-auto" role="group" aria-label="Ordenar por">
          {ORDERS.map((o) => (
            <button key={o.id} type="button" className="btn flex-1 sm:flex-none" data-active={order === o.id} aria-pressed={order === o.id} onClick={() => onOrder(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      </header>

      {!online ? (
        <p className="tile px-3 py-3 text-sm text-mute">Conecte a conta para calcular a melhor hunt do Pokémon equipado.</p>
      ) : error && !best ? (
        <div className="tile flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm">
          <p className="text-poke-red">{error}</p>
          <button type="button" className="btn" onClick={onRetry}>
            Tentar de novo
          </button>
        </div>
      ) : !best ? (
        <p className="tile flex items-center gap-2 px-3 py-3 text-sm text-mute" role="status">
          <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> Calculando as hunts. Na primeira vez baixa os dados do jogo e leva alguns segundos.
        </p>
      ) : ranked.length === 0 ? (
        <p className="tile px-3 py-3 text-sm text-mute">Nenhuma hunt liberada rende com esse Pokémon agora.</p>
      ) : (
        <>
          {cur && (
            <p className={`tile flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 py-2 text-xs ${gain < 0.05 ? "!border-poke-green/50 text-poke-green" : "text-mute"}`} aria-live="polite">
              {gain < 0.05 ? (
                <>
                  <Check className="size-3.5 shrink-0" aria-hidden /> <b>Você já caça numa das melhores hunts</b>
                </>
              ) : (
                <>
                  Hoje em <b className="text-fg">{cur.nome}</b>: <b className="tnum text-fg">{per(curMetric)}</b> {unit}
                  <ArrowRight className="size-3.5 shrink-0" aria-hidden /> em <b className="text-fg">{top?.nome}</b> rende
                  <b className="tnum text-poke-green">+{fmtInt(Math.round(gain * 100))}%</b>
                </>
              )}
            </p>
          )}

          <div className="space-y-1.5">
            {shown.map((l, i) => {
              const h = bySlug.get(l.slug)!;
              return (
                <HuntRow
                  key={l.slug}
                  h={h}
                  creatures={creatures}
                  level={level}
                  current={l.slug === currentSlug}
                  queued={l.slug === pendingSlug}
                  focused={l.slug === focusSlug}
                  canHunt={canHunt}
                  busy={busy}
                  calc={calcOf(l, i + 1, order)}
                  onFocus={onFocus}
                  onHunt={onHunt}
                />
              );
            })}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {ranked.length > SHOWN ? (
              <button type="button" className="text-xs font-semibold text-poke-gold hover:underline" onClick={() => setMore((v) => !v)}>
                {more ? "Mostrar menos" : `Mostrar mais ${Math.min(MAX, ranked.length) - SHOWN}`}
              </button>
            ) : (
              <span />
            )}
            <p className="flex items-center gap-1.5 text-[11px] text-mute">
              {loading && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-label="Recalculando" />}
              Estimativa do{" "}
              <a className="underline hover:text-fg" href={HUB} target="_blank" rel="noopener noreferrer">
                PokéIdle Hub
              </a>
              {best.versao ? ` (jogo ${best.versao})` : ""} · sem bônus de VIP ou boosts
            </p>
          </footer>
        </>
      )}
    </section>
  );
}

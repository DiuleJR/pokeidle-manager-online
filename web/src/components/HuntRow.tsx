import { Check, Crosshair, Lock, Skull, Star, Timer } from "lucide-react";
import { memo } from "react";
import { PokemonSprite } from "@/components/Sprites";
import type { Creature, Hunt } from "@/lib/actions";
import { TYPE_COLOR } from "@/lib/typeChart";
import { fmtInt } from "@/lib/utils";

export function TypeChip({ type, mult }: { type: string; mult?: number }) {
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

export const typesOf = (h: Hunt, creatures: Record<string, Creature> | null) => {
  const set = new Set<string>();
  for (const e of h.especies) for (const t of creatures?.[String(e.pokeId)]?.t ?? []) set.add(t);
  return [...set];
};

/** O que a calculadora diz de uma hunt para o Pokémon equipado (a linha ganha posição, rendimento e risco). */
export interface HuntCalc {
  rank: number;
  /** O número grande da direita (ex.: "71,5M") e a unidade embaixo (ex.: "XP/h"). */
  main: string;
  unit: string;
  /** Linha de apoio (ex.: "495 abates/h · Ouro 1,3M/h"). */
  sub: string;
  /** "one" = um golpe do selvagem pode matar; número = mortes por hora estimadas (só avisa a partir de 0,5). */
  risk?: "one" | number | null;
}

function Risk({ risk }: { risk: HuntCalc["risk"] }) {
  if (risk === "one")
    return (
      <span className="inline-flex items-center gap-1 rounded border border-[#7a2f27] bg-[#32140f] px-1.5 py-0.5 text-[10px] font-bold leading-none text-poke-red" title="Um golpe do selvagem pode tirar todo o HP do Pokémon">
        <Skull className="size-3" aria-hidden /> pode morrer de 1 golpe
      </span>
    );
  if (typeof risk === "number" && risk >= 0.5)
    return (
      <span className="inline-flex items-center gap-1 rounded border border-[#7a5a1c] bg-[#38290f] px-1.5 py-0.5 text-[10px] font-bold leading-none text-poke-gold" title="Mortes por hora estimadas">
        <Skull className="size-3" aria-hidden /> ~{risk.toFixed(1)} mortes/h
      </span>
    );
  return null;
}

/** Uma área do mapa (sprite, nome, nível, tipos e o botão de caçar). Com `calc`, mostra também o rendimento estimado. */
export const HuntRow = memo(function HuntRow({
  h,
  creatures,
  level,
  current,
  queued,
  focused,
  canHunt,
  busy,
  rank,
  calc,
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
  /** Posição (1 a 3) entre as melhores hunts para o Pokémon equipado. */
  rank?: number;
  calc?: HuntCalc;
  onFocus: (slug: string) => void;
  onHunt: (h: Hunt) => void;
}) {
  // A cara da área é a espécie com mais pontos de spawn (como no jogo).
  const main = [...h.especies].sort((a, b) => b.pontos - a.pontos)[0];
  const lk = (main && creatures?.[String(main.pokeId)]?.lk) || h.looktype;
  const types = typesOf(h, creatures);
  const locked = h.nivel > level;

  const action = current ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-poke-green/60 bg-[#16301c] px-2.5 py-1.5 text-xs font-extrabold uppercase tracking-wide text-poke-green">
      <Check className="size-3.5" aria-hidden /> Caçando
    </span>
  ) : queued ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-[#3a2a12] px-2.5 py-1.5 text-xs font-extrabold uppercase tracking-wide text-poke-gold">
      <Timer className="size-3.5" aria-hidden /> Na fila
    </span>
  ) : locked ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-black/30 px-2.5 py-1.5 text-xs font-bold text-mute" title={`Libera no nível ${fmtInt(h.nivel)}`}>
      <Lock className="size-3.5" aria-hidden /> Trancada
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
  );

  return (
    <div
      onPointerEnter={(e) => e.pointerType === "mouse" && onFocus(h.slug)}
      onClick={() => onFocus(h.slug)}
      className={`tile flex items-center gap-2.5 px-2 py-1.5 transition-colors duration-150 sm:gap-3 sm:px-3 ${
        current ? "!border-poke-green/70" : focused ? "!border-edge" : ""
      } ${locked ? "text-mute" : ""}`}
    >
      <span className="relative shrink-0">
        <span
          className={`flex size-11 items-center justify-center rounded-full border-2 sm:size-12 ${locked ? "border-line opacity-60 grayscale" : "border-edge/70"}`}
          style={{ background: "radial-gradient(circle at 50% 35%, #4a3519, #1a120a 75%)" }}
        >
          <PokemonSprite looktype={lk} size={40} />
        </span>
        {calc && (
          <span
            className={`tnum absolute -left-1 -top-1 grid size-5 place-items-center rounded-full border text-[11px] font-black leading-none ${calc.rank === 1 ? "border-poke-gold bg-poke-gold text-void" : "border-edge bg-[#2a1d0e] text-poke-gold"}`}
            aria-label={`Posição ${calc.rank}`}
          >
            {calc.rank}
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={`truncate text-[15px] font-bold leading-tight sm:text-base ${locked ? "text-mute" : ""}`}>{h.nome}</span>
          <span className={`tnum inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] font-extrabold leading-none ${locked ? "bg-black/30 text-mute" : "text-mute"}`}>
            {locked && <Lock className="size-2.5" aria-hidden />}
            Nv {fmtInt(h.nivel)}
          </span>
          {rank && !calc ? (
            <span className="inline-flex items-center gap-1 rounded border border-[#7a5a1c] bg-[#38290f] px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-poke-gold" title={`Nº ${rank} entre as hunts que mais rendem para o Pokémon equipado`}>
              <Star className="size-2.5 fill-poke-gold" aria-hidden /> Top {rank}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {types.length ? types.map((t) => <span key={t} className={locked ? "opacity-50 grayscale" : ""}><TypeChip type={t} /></span>) : <span className="text-xs text-mute">{h.especies.length} espécie(s)</span>}
          {calc && <Risk risk={calc.risk} />}
        </div>
        {calc && <p className="tnum mt-1 text-xs text-mute">{calc.sub}</p>}
      </div>
      {calc ? (
        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="text-right">
            <p className="tnum text-lg font-extrabold leading-none text-fg">{calc.main}</p>
            <p className="mt-1 text-[11px] leading-none text-mute">{calc.unit}</p>
          </div>
          {action}
        </div>
      ) : (
        action
      )}
    </div>
  );
});

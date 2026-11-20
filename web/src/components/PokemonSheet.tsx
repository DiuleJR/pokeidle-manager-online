import { motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TypeChip } from "@/components/HuntRow";
import { PokemonSprite } from "@/components/Sprites";
import {
  rangeBadge,
  rangeText,
  teamApi,
  type EvolutionBrief,
  type PokemonSheetPayload,
  type Species,
  type SpeciesPayload,
} from "@/lib/pvpTeam";
import { effectiveness, TYPES } from "@/lib/typeChart";

const EASE = [0.22, 1, 0.36, 1] as const;
const VIOLET = "#b66bff";
const nf = new Intl.NumberFormat("pt-BR");
const dec = (n: number, d = 1) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
/** 26.161.752 -> "26,2 mi"; abaixo de um milhão, o número inteiro. */
const compact = (n: number) => (n >= 1e9 ? `${dec(n / 1e9)} bi` : n >= 1e6 ? `${dec(n / 1e6)} mi` : nf.format(n));

const STAT_LABEL: [key: string, label: string, ivKey: string][] = [
  ["hp", "HP", "hp"],
  ["atk", "ATK", "atk"],
  ["def", "DEF", "def"],
  ["spAtk", "SP.ATK", "spAtk"],
  ["spDef", "SP.DEF", "spDef"],
  ["speed", "SPD", "speed"],
];
const BASE_KEY: Record<string, keyof Species> = { hp: "baseHp", atk: "baseAtk", def: "baseDef", spAtk: "baseSpAtk", spDef: "baseSpDef", speed: "baseSpeed" };
const GRADE_BANDS = ["Extremamente fraco", "Fraco", "Mediano", "Razoável", "Bom", "Forte", "Poderoso", "Mítico", "Lendário", "Divino"];
const GRADE_COLORS = ["#8a8a8a", "#ef6b5b", "#f08a3c", "#6fd47c", "#4fb4c2", "#4a8fd0", "#b05ad6", "#f3c04a", "#ffd56b", "#ff7ac8"];
/** Chance de cada potência na captura e o bônus que ela dá em todos os stats (as tabelas do jogo). */
const POTENCY = [
  { p: 1, chance: "74,5%", bonus: "—" },
  { p: 2, chance: "20,0%", bonus: "+5%" },
  { p: 3, chance: "5,00%", bonus: "+10%" },
  { p: 4, chance: "0,50%", bonus: "+25%" },
  { p: 5, chance: "0,0050%", bonus: "+100%" },
];
const POTENCY_COLOR = ["#d9b8c4", "#6fd47c", "#5cc8e8", "#c48bff", "#f3c04a"];

// ---------------------------------------------------------------- peças
function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-[#1b1209] p-3 ${className}`}>
      {title && <h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide" style={{ color: VIOLET }}>{title}</h4>}
      {children}
    </section>
  );
}

function Fact({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-tile px-2.5 py-2" style={tone ? { borderColor: tone } : undefined}>
      <div className="truncate text-[10px] font-extrabold uppercase tracking-wide text-mute">{label}</div>
      <div className="tnum text-lg font-extrabold leading-tight sm:text-xl" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="tnum text-[11px] leading-tight text-mute">{sub}</div>}
    </div>
  );
}

function Radar({ values, max, size = 170 }: { values: number[]; max: number; size?: number }) {
  const c = size / 2;
  const r = size / 2 - 22;
  const pt = (i: number, k: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
    return [c + Math.cos(a) * r * k, c + Math.sin(a) * r * k] as const;
  };
  const poly = (k: number[]) => k.map((v, i) => pt(i, v).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Gráfico dos stats" className="shrink-0">
      {[0.33, 0.66, 1].map((k) => (
        <polygon key={k} points={poly(Array(6).fill(k))} fill="none" stroke="#3b2b17" strokeWidth="1" />
      ))}
      {STAT_LABEL.map(([, label], i) => {
        const [x, y] = pt(i, 1.2);
        return <text key={label} x={x} y={y} fill="#b39a6e" fontSize="8.5" fontWeight="700" textAnchor="middle" dominantBaseline="middle">{label}</text>;
      })}
      <polygon points={poly(values.map((v) => Math.max(0.04, v / max)))} fill="rgba(111,212,124,.22)" stroke="#6fd47c" strokeWidth="1.6" />
    </svg>
  );
}

function StatBars({ rows }: { rows: { label: string; value: number; iv?: number; max: number; color?: string }[] }) {
  return (
    <ul className="min-w-[11rem] flex-1 space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-12 shrink-0 font-bold text-mute">{r.label}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-tile ring-1 ring-line">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, (r.value / r.max) * 100))}%`, background: r.color ?? "#6fd47c" }} />
          </span>
          <span className="tnum w-14 shrink-0 text-right font-bold">{nf.format(r.value)}</span>
          {r.iv !== undefined && <span className="tnum w-12 shrink-0 text-right text-[11px] font-semibold text-poke-green">IV {r.iv}</span>}
        </li>
      ))}
    </ul>
  );
}

function EvoBox({ e, current, note }: { e: EvolutionBrief; current?: boolean; note?: string }) {
  return (
    <div className={`flex w-24 flex-col items-center rounded-lg border-2 bg-tile px-1 py-1.5 text-center ${current ? "" : "opacity-80"}`} style={{ borderColor: current ? VIOLET : "#3b2b17" }}>
      <PokemonSprite looktype={e.looktype} size={44} />
      <span className="w-full truncate text-xs font-bold">{e.name}</span>
      {note && <span className="tnum text-[10px] text-mute">{note}</span>}
    </div>
  );
}

function Evolution({ ev, self }: { ev: SpeciesPayload["evolution"]; self: EvolutionBrief }) {
  if (!ev.prev && !ev.next) return <p className="text-sm text-mute">Não evolui.</p>;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {ev.prev && (
        <>
          <EvoBox e={ev.prev} />
          <span className="tnum text-xs font-bold text-mute">Nv {nf.format(ev.prevLevel)} →</span>
        </>
      )}
      <EvoBox e={self} current />
      {ev.next && (
        <>
          <span className="tnum text-xs font-bold text-mute">→ Nv {nf.format(ev.level)}</span>
          <EvoBox e={ev.next} />
        </>
      )}
    </div>
  );
}

// -------------------------------------------------------------- aba Pokémon
function PokemonTab({ d }: { d: PokemonSheetPayload }) {
  const p = d.pokemon;
  const ivSum = Object.values(p.ivs).reduce((s, v) => s + v, 0);
  const maxStat = Math.max(...Object.values(p.stats), 1);
  const bases = d.bases ?? {};
  const maxBase = Math.max(...Object.values(bases), 1);
  const gradeIdx = Math.min(9, Math.max(0, Math.ceil(p.nota) - 1));
  const refino = p.refino ?? {};
  const self: EvolutionBrief = { pokeId: p.speciesId, name: p.nome, looktype: p.looktype };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_15rem]">
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-extrabold sm:text-2xl">{p.nome}</h3>
            {(p.refinoTotal ?? 0) > 0 && <span className="rounded bg-poke-green/15 px-1.5 py-0.5 text-xs font-extrabold text-poke-green">+{p.refinoTotal}</span>}
            {p.shiny && <span title="Shiny">✨</span>}
            <span className="tnum rounded-full border border-line bg-tile px-2 py-0.5 text-xs font-bold">Nv {nf.format(p.level)}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">{p.tipos.map((t) => <TypeChip key={t} type={t} />)}</div>
          <p className="text-xs text-mute">Alcance no PVP: <b className="text-fg">{rangeBadge(d.range)} {rangeText(d.range)}</b>{p.tmElemental ? ` · Z-Move ${p.tmElemental}` : ""}</p>
          <div className="grid grid-cols-3 gap-2">
            <Fact label="Potência" value={`P${p.potencia}`} tone={POTENCY_COLOR[p.potencia - 1]} />
            <Fact label="Qualidade" value={dec(p.quality, 3)} tone="#f3c04a" />
            <Fact label="IV somado" value={<>{ivSum}<span className="text-sm text-mute">/192</span></>} tone="#5cc8e8" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Fact label="Poder no PVE" value={`⚔ ${compact(d.pvePower)}`} sub={`Ranking: ⚔ ${nf.format(p.poder)}`} />
            <Fact label="HP de combate" value={nf.format(d.combatHp)} />
            <Fact label="Poder no PVP" value={`⚔ ${nf.format(d.pvpPower)}`} sub={`conta como Nv ${nf.format(d.pvpLevel)}`} tone={VIOLET} />
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-line px-3 py-2" style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(182,107,255,.16), #1b1209 70%)" }}>
          <PokemonSprite looktype={p.shiny && p.lookShiny ? p.lookShiny : p.looktype} size={96} />
          <div className="tnum text-3xl font-extrabold" style={{ color: GRADE_COLORS[gradeIdx] }}>{dec(p.nota, 3)}<span className="text-sm text-mute"> / 10,0</span></div>
          <div className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: GRADE_COLORS[gradeIdx] }}>{GRADE_BANDS[gradeIdx]}</div>
          <div className="mt-1.5 flex w-full gap-0.5" aria-hidden>
            {GRADE_COLORS.map((c, i) => <span key={c} className="h-1.5 flex-1 rounded-sm" style={{ background: i <= gradeIdx ? c : "#2a1e12" }} />)}
          </div>
        </div>
      </div>

      <Card title="Stats atuais">
        <div className="flex flex-wrap items-center justify-center gap-3 sm:flex-nowrap">
          <Radar values={STAT_LABEL.map(([k]) => p.stats[k] ?? 0)} max={maxStat} />
          <StatBars rows={STAT_LABEL.map(([k, label, iv]) => ({ label, value: p.stats[k] ?? 0, iv: p.ivs[iv], max: maxStat }))} />
        </div>
        <p className="mt-2 text-[11px] leading-snug text-mute">O IV ao lado de cada stat é sorteado na captura (1 a 32 por stat, soma até 192). Sp.Atk e Sp.Def só contam em golpes especiais.</p>
      </Card>

      {d.bases && (
        <Card title="Stats-base da espécie">
          <StatBars
            rows={STAT_LABEL.map(([k, label]) => ({ label, value: bases[k] ?? 0, max: maxBase, color: refino[k] ? "#6fd47c" : VIOLET }))}
          />
          {(p.refinoTotal ?? 0) > 0 && <p className="mt-2 text-[11px] text-mute">Em verde, os stats refinados com pedras (+{p.refinoTotal} no total).</p>}
        </Card>
      )}

      <Card title="Evolução"><Evolution ev={d.evolution} self={self} /></Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="Experiência">
          <div className="h-2.5 overflow-hidden rounded-full bg-tile ring-1 ring-line">
            <div className="h-full rounded-full bg-[#5cc8e8]" style={{ width: `${Math.min(100, ((p.xp - p.xpNivel) / Math.max(1, p.xpProximo - p.xpNivel)) * 100)}%` }} />
          </div>
          <div className="tnum mt-1 text-right text-[11px] text-mute">{nf.format(p.xp - p.xpNivel)} / {nf.format(p.xpProximo - p.xpNivel)} xp</div>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <Fact label="XP acumulado" value={compact(p.xp)} />
            <Fact label="Faltam" value={compact(Math.max(0, p.xpProximo - p.xp))} />
          </div>
        </Card>
        <Card title="Identidade">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-[10px] font-extrabold uppercase text-mute">Identidade</dt><dd className="tnum font-bold" style={{ color: VIOLET }}>#{p.id}</dd></div>
            <div><dt className="text-[10px] font-extrabold uppercase text-mute">Capturado em</dt><dd className="font-bold">{p.caughtAt ? new Date(p.caughtAt).toLocaleDateString("pt-BR") : "—"}</dd></div>
            <div className="col-span-2"><dt className="text-[10px] font-extrabold uppercase text-mute">Espécie</dt><dd className="font-bold">#{p.speciesId} {p.nome}</dd></div>
          </dl>
        </Card>
      </div>

      <Card title="A potência deste Pokémon">
        <div className="grid grid-cols-5 gap-1.5">
          {POTENCY.map((x) => {
            const mine = x.p === p.potencia;
            return (
              <div key={x.p} className="rounded-lg border-2 bg-tile px-1 py-2 text-center" style={{ borderColor: mine ? POTENCY_COLOR[x.p - 1] : "#3b2b17" }}>
                {mine && <div className="text-[9px] font-extrabold uppercase text-mute">é este</div>}
                <div className="text-base font-extrabold" style={{ color: POTENCY_COLOR[x.p - 1] }}>P{x.p}</div>
                <div className="tnum text-[11px] font-bold">{x.chance}</div>
                <div className="tnum text-[11px] font-semibold text-poke-green">{x.bonus}</div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-mute">A potência é sorteada uma vez, na captura, e nunca muda. Cada nível acima de P1 multiplica todos os stats.</p>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------- aba Espécie
function SpeciesTab({ d }: { d: SpeciesPayload }) {
  const s = d.species;
  const types = useMemo(() => (s ? [s.type1, s.type2].filter(Boolean) as string[] : []), [s]);
  if (!s) return <p className="py-8 text-center text-mute">Dados da espécie indisponíveis.</p>;
  const weak = TYPES.filter((t) => effectiveness(t, types) > 1).map((t) => ({ t, m: effectiveness(t, types) }));
  const resist = TYPES.filter((t) => effectiveness(t, types) < 1).map((t) => ({ t, m: effectiveness(t, types) }));
  const strong = TYPES.filter((t) => types.some((own) => effectiveness(own, [t]) > 1));
  const maxBase = Math.max(s.baseHp, s.baseAtk, s.baseDef, s.baseSpAtk, s.baseSpDef, s.baseSpeed, 1);
  const self: EvolutionBrief = { pokeId: s.pokeId, name: s.name, looktype: s.looktype };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div className="min-w-0 space-y-2.5">
          <div className="text-xs font-extrabold" style={{ color: VIOLET }}>#{s.pokeId}</div>
          <h3 className="-mt-1.5 text-xl font-extrabold sm:text-2xl">{s.name}</h3>
          <div className="flex flex-wrap gap-1.5">{types.map((t) => <TypeChip key={t} type={t} />)}</div>
          <div className="grid grid-cols-2 gap-2">
            <Fact label="Derrotados" value={d.pokedex.defeated != null ? nf.format(d.pokedex.defeated) : "—"} />
            <Fact label="Capturados" value={d.pokedex.captured != null ? nf.format(d.pokedex.captured) : "—"} tone="#f3c04a" />
          </div>
        </div>
        <div className="flex items-center justify-center rounded-xl border border-line" style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(182,107,255,.16), #1b1209 70%)" }}>
          <PokemonSprite looktype={s.looktype} size={104} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Fact label="Nível na hunt" value={nf.format(s.huntLevel)} />
        <Fact label="XP por derrota" value={nf.format(s.experience)} />
        <Fact label="O NPC paga" value={s.sellValue != null ? nf.format(s.sellValue) : "—"} tone="#f3c04a" />
        <Fact label="Alcance no PVP" value={rangeBadge(d.range)} sub={rangeText(d.range)} />
      </div>

      <Card title="Evolução"><Evolution ev={d.evolution} self={self} /></Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="Stats-base">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Radar size={150} max={maxBase} values={STAT_LABEL.map(([k]) => Number(s[BASE_KEY[k]]) || 0)} />
            <StatBars rows={STAT_LABEL.map(([k, label]) => ({ label, value: Number(s[BASE_KEY[k]]) || 0, max: maxBase, color: VIOLET }))} />
          </div>
        </Card>
        <Card title="Tipos em batalha">
          <div className="space-y-2">
            <div><div className="mb-1 text-[11px] font-bold text-mute">Forte contra</div><div className="flex flex-wrap gap-1">{strong.length ? strong.map((t) => <TypeChip key={t} type={t} mult={2} />) : <span className="text-xs text-mute">—</span>}</div></div>
            <div><div className="mb-1 text-[11px] font-bold text-mute">Fraco contra</div><div className="flex flex-wrap gap-1">{weak.length ? weak.map((x) => <TypeChip key={x.t} type={x.t} mult={x.m} />) : <span className="text-xs text-mute">—</span>}</div></div>
            <div><div className="mb-1 text-[11px] font-bold text-mute">Resiste a</div><div className="flex flex-wrap gap-1">{resist.length ? resist.map((x) => <TypeChip key={x.t} type={x.t} mult={x.m} />) : <span className="text-xs text-mute">—</span>}</div></div>
          </div>
        </Card>
      </div>

      <Card title="Golpes">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] text-sm">
            <thead className="text-left text-[11px] text-mute"><tr><th className="py-1 font-semibold">Golpe</th><th className="font-semibold">Tipo</th><th className="font-semibold">Categoria</th><th className="text-right font-semibold">Dano base</th><th className="text-right font-semibold">Cooldown</th></tr></thead>
            <tbody>
              {s.attacks.map((a) => (
                <tr key={a.name} className="border-t border-line">
                  <td className="py-1 font-semibold">{a.name}</td>
                  <td><TypeChip type={a.type} /></td>
                  <td className="text-mute">{a.category === "SPECIAL" ? "Especial" : "Físico"}</td>
                  <td className="tnum text-right font-bold" style={{ color: "#ff9bd0" }}>{nf.format(a.power)}</td>
                  <td className="tnum text-right text-mute">{Math.round(a.cooldownMs / 1000)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-mute">O dano base entra na fórmula de combate do servidor: o dano final depende de nível, stats e tipo.</p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="Drops">
          <ul className="space-y-1 text-sm">
            {s.loot.filter((l) => l.chance > 0).map((l) => (
              <li key={l.name} className="flex justify-between gap-2 border-b border-line/60 pb-1 last:border-0">
                <span className="truncate font-semibold">{l.name}</span>
                <span className="tnum shrink-0 text-mute">{l.minCount === l.maxCount ? l.minCount : `${l.minCount}–${l.maxCount}`}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Onde encontrar">
          {d.foundIn.length ? (
            <ul className="space-y-1 text-sm">
              {d.foundIn.map((h) => (
                <li key={h.slug} className="flex justify-between gap-2"><span className="truncate font-semibold">{h.name}</span><span className="tnum shrink-0 text-mute">Nv {nf.format(h.level)}</span></li>
              ))}
            </ul>
          ) : <p className="text-sm text-mute">Não aparece em nenhuma hunt desta conta.</p>}
        </Card>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- janela
export function PokemonSheet({ account, pokemonId, onClose }: { account: number; pokemonId: number; onClose: () => void }) {
  const [tab, setTab] = useState<"pokemon" | "species">("pokemon");
  const [data, setData] = useState<PokemonSheetPayload | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    teamApi.pokemon(account, pokemonId).then((d) => live && setData(d)).catch((e) => live && setErr(e instanceof Error ? e.message : "Falha ao abrir a ficha"));
    return () => { live = false; };
  }, [account, pokemonId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tabs = [["pokemon", "Pokémon"], ["species", "Espécie"]] as const;
  return (
    <motion.div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} role="presentation">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Ficha do Pokémon"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        onClick={(e) => e.stopPropagation()}
        className="card flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-b-none sm:rounded-b-2xl"
      >
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 sm:px-4">
          <div role="tablist" className="flex gap-1">
            {tabs.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className="btn" data-active={tab === id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          <button type="button" className="btn" onClick={onClose} aria-label="Fechar a ficha"><X className="size-4" aria-hidden /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {!data && !err && <div className="flex justify-center py-16 text-mute"><Loader2 className="size-6 animate-spin" aria-label="Carregando" /></div>}
          {err && <p className="py-10 text-center text-poke-red" role="alert">{err}</p>}
          {data && (tab === "pokemon" ? <PokemonTab d={data} /> : <SpeciesTab d={data} />)}
        </div>
      </motion.div>
    </motion.div>
  );
}

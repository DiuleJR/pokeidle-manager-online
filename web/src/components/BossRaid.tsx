import { motion } from "framer-motion";
import { Check, Flame, Loader2, Swords, Users, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { EASE, pt, VIOLET } from "@/components/bossUi";
import { ItemSprite, PokemonSprite } from "@/components/Sprites";
import { bossApi, raidClock, raidPhase, raidShort, type BossAccount, type BossEntry, type RaidInfo, type RaidPhase } from "@/lib/boss";
import { TYPE_COLOR } from "@/lib/typeChart";
import { everyWhileVisible } from "@/lib/visible";

export const RAID_KEY = "@raid";
const SITE = "https://pokeidle.io";
const TYPE_PT: Record<string, string> = {
  NORMAL: "Normal", FIRE: "Fogo", WATER: "Água", ELECTRIC: "Elétrico", GRASS: "Planta", ICE: "Gelo", FIGHTING: "Lutador",
  POISON: "Veneno", GROUND: "Terra", FLYING: "Voador", PSYCHIC: "Psíquico", BUG: "Inseto", ROCK: "Pedra", GHOST: "Fantasma",
  DRAGON: "Dragão", DARK: "Sombrio", STEEL: "Aço", FAIRY: "Fada",
};

/** Hora do servidor, atualizada a cada `ms` enquanto a aba está visível. */
function useServerNow(r: RaidInfo | null, ms: number) {
  const [, tick] = useState(0);
  useEffect(() => everyWhileVisible(() => tick((n) => n + 1), ms), [ms]);
  return Date.now() + (r?.offset ?? 0);
}

/** O Gigantamax vem num quadro de 4×4 (512 px); o primeiro quadro é a pose parada. */
function GmaxSprite({ r, size }: { r: RaidInfo; size: number }) {
  return (
    <span
      role="img"
      aria-label={r.gigantamax.nome}
      className="inline-block shrink-0"
      style={{ width: size, height: size, backgroundImage: `url('${SITE}${r.gigantamax.sprite}')`, backgroundSize: `${size * 4}px ${size * 4}px`, backgroundPosition: "0 0", imageRendering: "pixelated" }}
    />
  );
}

const PHASE_LEAD: Record<RaidPhase, string> = {
  antes: "As inscrições abrem em",
  inscricoes: "As inscrições fecham em",
  preparo: "Inscrições encerradas · a batalha começa em",
  portal: "O portal está abrindo",
  batalha: "Batalha ao vivo há",
  resultado: "Batalha encerrada · o próximo Raid em",
  fim: "Raid encerrado",
};

function phaseClock(r: RaidInfo, phase: RaidPhase, now: number): number {
  const e = r.edicao;
  switch (phase) {
    case "antes": return e.inscricoesDe - now;
    case "inscricoes": return e.inscricoesAte - now;
    case "preparo": return e.batalhaEm - now;
    case "portal": return e.transmissaoEm - now;
    case "batalha": return now - e.transmissaoEm;
    default: return e.fimEm - now;
  }
}

/** Dia e hora da batalha em Brasília ("segunda-feira, 20:00"). */
function battleWhen(r: RaidInfo): string {
  const d = new Date(r.edicao.batalhaEm - 3 * 3_600_000);
  const dow = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"][d.getUTCDay()];
  return `${dow}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- lista
/** O boss semanal no topo da lista, como no jogo. */
export function RaidListItem({ raid, selected, onSelect }: { raid: RaidInfo; selected: boolean; onSelect: () => void }) {
  const now = useServerNow(raid, 15_000);
  const phase = raidPhase(raid, now);
  const short = phase === "antes" || phase === "inscricoes" || phase === "preparo" ? raidShort(phaseClock(raid, phase, now)) : phase === "batalha" || phase === "portal" ? "AO VIVO" : "";
  const color = TYPE_COLOR[raid.gigantamax.golpes.gmax.t] ?? VIOLET;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-h-14 items-center gap-2 rounded-lg border-2 px-2 py-1 text-left transition-[background-color,border-color] duration-200 ${selected ? "border-[#f3c04a]" : "border-[#5a3d86] hover:border-[#8a5fd0]"}`}
      style={{ background: `linear-gradient(135deg, ${color}40, #2a1650 70%)` }}
    >
      <GmaxSprite r={raid} size={44} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide text-poke-gold"><Flame className="size-3" aria-hidden /> Semanal</span>
        <span className="block truncate text-sm font-extrabold leading-tight">{raid.gigantamax.nome}</span>
      </span>
      {short && <span className="tnum shrink-0 rounded bg-black/40 px-1.5 py-0.5 text-[11px] font-bold text-poke-green">{short}</span>}
    </button>
  );
}

// ---------------------------------------------------------------- ficha
export function RaidFicha({ raid, a, token, onChanged }: { raid: RaidInfo; a: BossAccount | undefined; token: BossEntry | null; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const now = useServerNow(raid, 1000);
  const phase = raidPhase(raid, now);
  const g = raid.gigantamax;
  const e = raid.edicao;
  const color = TYPE_COLOR[g.golpes.gmax.t] ?? VIOLET;
  const have = a ? a.items[String(raid.token.itemId)] ?? 0 : 0;
  const enrolled = !!a?.raid?.inscrito;
  const canEnroll = !!a?.online && phase === "inscricoes" && !enrolled && have >= raid.token.qtd;
  const bars = [...raid.bonus.tabela].sort((x, y) => y.resto - x.resto);

  const enroll = async () => {
    if (!a) return;
    const ok = window.confirm(
      `Inscrever ${a.nick} no Raid #${e.numero} (${g.nome})?\n\nGasta ${raid.token.qtd}× ${token?.name ?? "Bronze Boss Token"}. Você luta com a equipe de hunt (até ${raid.maxEquipe} Pokémon) e a ficha não volta. A batalha é ${battleWhen(raid)}, ao vivo, com o servidor inteiro.`,
    );
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      await bossApi.enrollRaid(a.id);
      await onChanged();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Falha ao inscrever");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl border border-[#5a3d86] p-3 sm:p-4" style={{ background: `radial-gradient(120% 140% at 0% 0%, ${color}55, #1a0f33 65%)` }}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <motion.span initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: EASE }} className="mx-auto shrink-0 sm:mx-0">
            <GmaxSprite r={raid} size={136} />
          </motion.span>
          <div className="min-w-0 flex-1 basis-56">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f3c04a] bg-[#38290f] px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-poke-gold">
              <Flame className="size-3.5" aria-hidden /> Semanal · Raid Gigantamax #{e.numero}
            </span>
            <h3 className="mt-1.5 text-2xl font-extrabold uppercase leading-tight sm:text-3xl">{g.nome}</h3>
            <div className="text-xs font-extrabold uppercase tracking-[0.3em] text-mute">Gigantamax</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {g.tipos.map((t) => (
                <span key={t} className="rounded px-2 py-0.5 text-[11px] font-extrabold uppercase text-white" style={{ background: TYPE_COLOR[t] ?? "#555", textShadow: "0 1px 0 rgba(0,0,0,.45)" }}>{TYPE_PT[t] ?? t}</span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[g.golpes.gmax, g.golpes.max, g.golpes.onda].map((m) => (
                <span key={m.n} className="rounded-md border px-2 py-0.5 text-[11px] font-bold" style={{ borderColor: TYPE_COLOR[m.t] ?? "#555", background: `${TYPE_COLOR[m.t] ?? "#555"}33` }}>{m.n}</span>
              ))}
            </div>
            <div className="tnum mt-2 text-sm"><b className="text-lg">+ {pt.format(g.hpMax)}</b> <span className="text-mute">de vida</span></div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#5a3d86] bg-[#1a0f33] px-3 py-3 text-center" role="timer" aria-live="off">
        <div className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: VIOLET }}>
          {(phase === "batalha" || phase === "portal") && <span className="mr-1.5 inline-block size-2 animate-pulse rounded-full bg-poke-red align-middle" aria-hidden />}
          {PHASE_LEAD[phase]}
        </div>
        {phase !== "fim" && <div className="tnum mt-0.5 text-3xl font-extrabold tracking-wide sm:text-4xl">{raidClock(phaseClock(raid, phase, now))}</div>}
        <div className="mt-0.5 text-xs text-mute">A batalha: {battleWhen(raid)} — o servidor inteiro, ao vivo</div>
      </div>

      <div className="grid gap-3 rounded-xl border border-line bg-tile p-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div className="flex items-center gap-3 sm:flex-col sm:gap-0 sm:text-center">
          <Users className="size-5 text-mute" aria-hidden />
          <div>
            <div className="tnum text-2xl font-extrabold leading-none">{pt.format(raid.inscritos)}</div>
            <div className="text-[11px] font-semibold uppercase text-mute">treinadores inscritos</div>
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-bold"><Zap className="size-4 text-poke-gold" aria-hidden /> Até <span className="text-poke-gold">+{raid.bonus.xpMax}% de XP</span> e <span className="text-poke-gold">+{raid.bonus.farmMax}% de farm</span> por {raid.bonus.horas} horas</div>
          <div className="mt-2 flex h-10 items-end gap-1" aria-hidden>
            {bars.map((b, i) => (
              <span key={b.resto} className="flex-1 rounded-t-sm" style={{ height: `${Math.max(8, (b.bonus / raid.bonus.max) * 100)}%`, background: `linear-gradient(180deg, #f3b13a, ${VIOLET})`, opacity: 0.35 + (i / bars.length) * 0.65 }} title={`Boss com ${b.resto}% de vida: +${b.xp}% XP, +${b.farm}% farm`} />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-mute">Quanto mais vida o servidor tirar dele, maior o bônus de todo inscrito.</p>
        </div>
      </div>

      {a ? (
        <section aria-label="Inscrição" className="flex flex-col gap-3 rounded-xl border border-line bg-black/20 p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h4 className="text-[11px] font-extrabold uppercase tracking-wide text-mute">Equipe da Raid <span className="font-medium normal-case">· a sua equipe de hunt</span></h4>
              {a.team.length === 0 ? (
                <span className="text-xs font-semibold text-poke-red">Monte a equipe de hunt no jogo.</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {a.team.map((k) => (
                    <div key={k.id} className="flex w-14 flex-col items-center rounded-lg border border-line bg-tile px-1 pb-1 pt-0.5" title={`${k.name} · Nv ${pt.format(k.level)}`}>
                      <PokemonSprite looktype={k.looktype} size={34} />
                      <span className="tnum text-[10px] font-bold">{pt.format(k.level)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${enrolled || have >= raid.token.qtd ? "border-line bg-tile" : "border-[#7a3030] bg-[#2a1212]"}`}>
              <ItemSprite icon={token?.icon} size={26} alt="" />
              <span className="flex flex-col leading-tight">
                <span className="text-[11px] font-semibold uppercase text-mute">Entrada</span>
                <b className="text-sm">{raid.token.qtd}× {token?.name ?? "Bronze Boss Token"}</b>
              </span>
              <span className="tnum ml-2 rounded-md bg-black/30 px-2 py-1 font-bold" title="Quantas você tem">{pt.format(have)}</span>
            </div>
          </div>
          {enrolled ? (
            <p className="flex items-center justify-center gap-2 rounded-lg border border-[#2f6b3a] bg-[#142b19] px-3 py-3 text-sm font-extrabold text-poke-green">
              <Check className="size-4" aria-hidden /> {a.nick} está inscrito neste Raid
            </p>
          ) : (
            <button type="button" className="btn min-h-12 w-full !border-[#b66bff] !bg-[#3a2560] text-base font-extrabold disabled:!border-line disabled:!bg-tile" disabled={!canEnroll || busy} onClick={() => void enroll()}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Swords className="size-4" aria-hidden />}
              {!a.online ? "Conta offline" : phase === "antes" ? "Inscrições ainda não abriram" : phase !== "inscricoes" ? "Inscrições encerradas" : have < raid.token.qtd ? "Sem entrada" : "Inscrever-se"}
            </button>
          )}
          {err && <p className="rounded-md bg-poke-red/10 px-2 py-1 text-xs text-poke-red" role="alert">{err}</p>}
        </section>
      ) : (
        <p className="rounded-lg border border-line bg-tile px-3 py-2 text-sm text-mute">Nenhuma conta conectada.</p>
      )}
    </div>
  );
}

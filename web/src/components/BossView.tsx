import { motion } from "framer-motion";
import { Clock, Flame, HeartPulse, Loader2, LogOut, Repeat, Swords, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ArenaView, SummaryModal } from "@/components/BossArena";
import { RAID_KEY, RaidFicha, RaidListItem } from "@/components/BossRaid";
import { BossArt, EASE, hms, OptionTile, pt, VIOLET } from "@/components/bossUi";
import { ItemSprite, PokemonSprite } from "@/components/Sprites";
import {
  bossApi,
  chanceLabel,
  PHASE_LABEL,
  PRIZE_LABEL,
  rarityOf,
  RARITY_COLOR,
  RARITY_LABEL,
  teamPenalty,
  useBosses,
  type Boss,
  type BossAccount,
  type BossDay,
  type BossDrop,
  type BossOverview,
} from "@/lib/boss";
import { serverNow } from "@/lib/telemetry";
import { matchup, TYPE_COLOR } from "@/lib/typeChart";
import { everyWhileVisible } from "@/lib/visible";

const TYPE_PT: Record<string, string> = {
  NORMAL: "Normal", FIRE: "Fogo", WATER: "Água", ELECTRIC: "Elétrico", GRASS: "Planta", ICE: "Gelo", FIGHTING: "Lutador",
  POISON: "Veneno", GROUND: "Terra", FLYING: "Voador", PSYCHIC: "Psíquico", BUG: "Inseto", ROCK: "Pedra", GHOST: "Fantasma",
  DRAGON: "Dragão", DARK: "Sombrio", STEEL: "Aço", FAIRY: "Fada",
};

const shortCount = (n: number) => (n < 1000 ? pt.format(n) : n < 1_000_000 ? `${pt.format(Math.floor(n / 1000))}k` : `${pt.format(Math.floor(n / 1_000_000))}M`);

function TypeBadge({ type, small }: { type: string; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded font-extrabold uppercase tracking-wide text-white ${small ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-[11px]"}`}
      style={{ background: TYPE_COLOR[type] ?? "#555", textShadow: "0 1px 0 rgba(0,0,0,.45)" }}
    >
      {TYPE_PT[type] ?? type}
    </span>
  );
}

/** Ícones dos prêmios de um dia, miúdos, para as linhas da lista e do rodízio. */
function PrizeIcons({ day, size = 18 }: { day: BossDay | undefined; size?: number }) {
  if (!day || day.drops.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5" title={day.prize ? PRIZE_LABEL[day.prize] : undefined}>
      {day.drops.map((d, i) => (
        <ItemSprite key={`${d.itemId}-${i}`} icon={d.icon} size={size} alt={d.name} />
      ))}
    </span>
  );
}

// ------------------------------------------------------------------ lista
function BossList({ catalog, selected, onSelect, wins, raid }: { catalog: Boss[]; selected: string; onSelect: (k: string) => void; wins: Record<string, number>; raid: BossOverview["raid"] }) {
  const groups = useMemo(() => {
    const ordered = [...catalog].sort((a, b) => Number(b.playable) - Number(a.playable) || a.level - b.level || (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name));
    const out: { region: string; name: string; trio: string | null; level: number; items: Boss[] }[] = [];
    for (const b of ordered) {
      const region = b.region ?? "";
      const last = out[out.length - 1];
      if (last && last.region === region) last.items.push(b);
      else out.push({ region, name: b.regionName, trio: b.trio, level: b.level, items: [b] });
    }
    return out;
  }, [catalog]);

  return (
    <nav aria-label="Bosses" className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1 lg:max-h-[44rem]">
      {raid && <RaidListItem raid={raid} selected={selected === RAID_KEY} onSelect={() => onSelect(RAID_KEY)} />}
      {raid && <div className="px-1 pt-1 text-[11px] font-extrabold uppercase tracking-wide text-mute">Bosses</div>}
      {groups.map((g) => (
        <div key={g.region || "outros"} className="flex flex-col gap-1">
          {g.region && (
            <div className="sticky top-0 z-10 flex items-baseline justify-between gap-2 bg-[#1d140b] px-1 pb-0.5 pt-1.5">
              <span className="text-xs font-extrabold uppercase tracking-wide text-poke-gold">{g.name}</span>
              <span className="tnum text-[11px] font-semibold text-mute">Nível {pt.format(g.level)}</span>
            </div>
          )}
          {g.trio && <div className="-mt-0.5 px-1 text-[11px] text-mute">{g.trio}</div>}
          {g.items.map((b) => {
            const on = b.key === selected;
            const n = wins[b.key] ?? 0;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => onSelect(b.key)}
                aria-pressed={on}
                className={`flex min-h-11 items-center gap-2 rounded-lg border px-2 py-1 text-left transition-[background-color,border-color] duration-200 ${on ? "border-[#b66bff] bg-[#2e1f45]" : "border-line bg-tile hover:border-edge/60"} ${b.playable ? "" : "opacity-55"}`}
              >
                <PokemonSprite looktype={b.looktype} species={b.pokeId} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{b.name}</span>
                  {!b.playable && <span className="block text-[11px] text-mute">Em breve</span>}
                </span>
                {b.playable && <PrizeIcons day={b.days[0]} size={16} />}
                {n > 0 && (
                  <span className="tnum inline-flex items-center gap-0.5 rounded bg-black/30 px-1 text-[11px] font-bold text-poke-gold" title={`${pt.format(n)} vitórias`}>
                    <Trophy className="size-3" aria-hidden />
                    {shortCount(n)}
                  </span>
                )}
                <span className="tnum shrink-0 text-[11px] font-semibold text-mute">Nv {pt.format(b.level)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- recompensas
function DropCard({ d, have, index }: { d: BossDrop; have: number; index: number }) {
  const rar = rarityOf(d.chance);
  const color = RARITY_COLOR[rar];
  const umEm = d.chance ? Math.round(1 / d.chance) : null;
  const qty = d.qty ? (d.qty[0] === d.qty[1] ? `×${d.qty[0]}` : `×${d.qty[0]}–${d.qty[1]}`) : "";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index, 6) * 0.04, ease: EASE }}
      className="flex w-36 flex-col items-center gap-1 rounded-xl border-2 px-2 pb-2 pt-1 text-center"
      style={{ borderColor: color, background: `linear-gradient(180deg, ${color}26, #16100a 70%)` }}
      title={d.chance != null ? `${d.name}: 1 em ${pt.format(umEm ?? 0)}` : `${d.name}: sempre cai`}
    >
      <span className="text-[10px] font-extrabold tracking-widest" style={{ color }}>{RARITY_LABEL[rar]}</span>
      <ItemSprite icon={d.icon} size={44} alt="" />
      <b className="text-xs leading-tight">
        {d.name} {qty && <i className="font-semibold not-italic text-mute">{qty}</i>}
      </b>
      <span className="tnum rounded-full border px-2 py-0.5 text-xs font-bold" style={{ borderColor: color, color }}>
        {d.chance != null ? chanceLabel(d.chance) : "Sempre"}
      </span>
      <span className="tnum text-[11px] text-mute">
        {umEm ? `1 em ${pt.format(umEm)} · ` : ""}
        você tem <b className={have ? "text-fg" : ""}>{pt.format(have)}</b>
      </span>
    </motion.div>
  );
}

function RotationLine({ boss, nextRotation }: { boss: Boss; nextRotation: number }) {
  const [, tick] = useState(0);
  useEffect(() => everyWhileVisible(() => tick((n) => n + 1), 30_000), []);
  if (boss.position == null || !boss.days[0]?.prize) return null;
  const left = nextRotation - serverNow();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-tile px-3 py-2 text-xs">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <Clock className="size-3.5 text-poke-gold" aria-hidden />
        Prêmio de hoje · troca às 18:00 (em <span className="tnum">{hms(left)}</span>)
      </span>
      {[1, 2].map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5 text-mute">
          <em className="not-italic">{k === 1 ? "Amanhã" : "Depois"}</em>
          <PrizeIcons day={boss.days[k]} />
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- ficha
function Fraquezas({ types }: { types: string[] }) {
  const { weak } = useMemo(() => matchup(types), [types]);
  if (!weak.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-[11px] font-semibold uppercase text-mute">Fraco a</span>
      {weak.map((w) => (
        <span key={w.type} className="inline-flex items-center gap-0.5">
          <TypeBadge type={w.type} small />
          <span className="tnum text-[11px] font-bold text-mute">×{w.mult}</span>
        </span>
      ))}
    </span>
  );
}

function TeamPips({ a, boss }: { a: BossAccount; boss: Boss }) {
  if (!a.team.length) return <span className="text-xs font-semibold text-poke-red">Monte a equipe de hunt no jogo antes de lutar.</span>;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Equipe">
      {a.team.map((k) => {
        const pct = k.maxHp ? Math.min(100, Math.max(0, (k.hp / k.maxHp) * 100)) : 100;
        const weak = boss.teamLevel != null && k.level < boss.teamLevel;
        return (
          <div key={k.id} className={`flex w-14 flex-col items-center rounded-lg border bg-tile px-1 pb-1 pt-0.5 ${pct <= 0 ? "opacity-50" : ""}`} style={{ borderColor: weak ? "#7a3030" : "#3b2b17" }} title={`${k.name} · Nv ${pt.format(k.level)}`}>
            <PokemonSprite looktype={k.looktype} size={34} />
            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-black/40" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`HP de ${k.name}`}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct < 35 ? "#ef6b5b" : "#6fd47c" }} />
            </div>
            <span className="tnum text-[10px] font-bold" style={{ color: weak ? "#ef6b5b" : undefined }}>{pt.format(k.level)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Ficha({ boss, a, data, onChanged }: { boss: Boss; a: BossAccount | undefined; data: BossOverview; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setErr(""), [boss.key, a?.id]);

  const wins = a?.wins[boss.key] ?? 0;
  const today = boss.days[0];
  const drops = useMemo(() => [...(today?.drops ?? [])].sort((x, y) => (y.chance ?? 1) - (x.chance ?? 1)), [today]);
  const have = (id: number | null) => (id == null || !a ? 0 : a.items[String(id)] ?? 0);
  const tokens = boss.entry ? have(boss.entry.itemId) : 0;
  const levelOk = !a || a.level >= boss.minTrainerLevel;
  const running = !!a?.run && !a.run.finished;
  const inArena = !!a?.arena || running;
  const inThis = a?.arena?.key === boss.key || (running && a?.run?.key === boss.key);
  const pen = a && boss.playable ? teamPenalty(a.team, boss) : null;
  const canEnter = !!a?.online && boss.playable && levelOk && !inArena && tokens >= (boss.entry?.qty ?? 1) && a.team.length > 0;
  const autoOnThis = !!a?.auto && a.autoKey === boss.key;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao enviar o comando");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-3 rounded-xl border border-line p-3" style={{ background: `radial-gradient(120% 140% at 0% 0%, ${TYPE_COLOR[boss.types[0]] ?? "#3b2b17"}33, #16100a 70%)` }}>
        <span className="shrink-0 rounded-lg bg-black/25 p-1"><BossArt boss={boss} size={80} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xl font-extrabold leading-tight sm:text-2xl">{boss.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            {boss.region && <span className="rounded border border-line bg-black/25 px-1.5 py-0.5">{boss.regionName}{boss.trio ? ` · ${boss.trio}` : ""}</span>}
            <span className="tnum rounded border border-line bg-black/25 px-1.5 py-0.5">Nível {pt.format(boss.level)}{boss.playable ? " · fixo" : ""}</span>
            {boss.playable && (
              <span className="tnum rounded border px-1.5 py-0.5" style={{ borderColor: levelOk ? "#3b2b17" : "#7a3030", color: levelOk ? undefined : "#ef6b5b" }}>
                Treinador nv {pt.format(boss.minTrainerLevel)}+
              </span>
            )}
            <span className="tnum rounded border border-line bg-black/25 px-1.5 py-0.5 text-poke-gold">Vezes derrotado: {pt.format(wins)}</span>
          </div>
          {boss.types.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex gap-1">{boss.types.map((t) => <TypeBadge key={t} type={t} />)}</span>
              <Fraquezas types={boss.types} />
            </div>
          )}
        </div>
      </div>

      <section aria-label="Recompensas" className="flex flex-col gap-2">
        <h4 className="text-sm font-extrabold uppercase tracking-wide">
          Recompensas <span className="text-xs font-medium normal-case text-mute">por vitória, a chance vale para cada luta</span>
        </h4>
        {boss.playable && <RotationLine boss={boss} nextRotation={data.nextRotation} />}
        {drops.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {drops.map((d, i) => (
              <DropCard key={`${d.itemId}-${i}`} d={d} have={have(d.itemId)} index={i} />
            ))}
          </div>
        ) : boss.dropNames.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {boss.dropNames.map((n) => <li key={n} className="rounded border border-line bg-tile px-2 py-1">{n}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-mute">Sem recompensas listadas.</p>
        )}
      </section>

      {!boss.playable ? (
        <p className="rounded-lg border border-line bg-tile px-3 py-2 text-sm text-mute">Este boss ainda não tem arena no jogo.</p>
      ) : !a ? (
        <p className="rounded-lg border border-line bg-tile px-3 py-2 text-sm text-mute">Nenhuma conta conectada.</p>
      ) : (
        <section aria-label="Desafio" className="flex flex-col gap-3 rounded-xl border border-line bg-black/20 p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h4 className="text-[11px] font-extrabold uppercase tracking-wide text-mute">Sua equipe</h4>
              <TeamPips a={a} boss={boss} />
            </div>
            {boss.entry && (
              <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${tokens >= boss.entry.qty ? "border-line bg-tile" : "border-[#7a3030] bg-[#2a1212]"}`}>
                <ItemSprite icon={boss.entry.icon} size={26} alt="" />
                <span className="flex flex-col leading-tight">
                  <span className="text-[11px] font-semibold uppercase text-mute">Entrada</span>
                  <b className="text-sm">{boss.entry.qty}× {boss.entry.name}</b>
                </span>
                <span className="tnum ml-2 rounded-md bg-black/30 px-2 py-1 font-bold" title="Quantas você tem">{pt.format(tokens)}</span>
              </div>
            )}
          </div>

          {pen && a.team.length > 0 && (
            <p className="tnum rounded-md border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: pen.mult >= 2 ? "#7a3030" : "#2f6b3a", color: pen.mult >= 2 ? "#ef6b5b" : "#6fd47c", background: pen.mult >= 2 ? "#2a121299" : "#142b1999" }}>
              Equipe: {pen.strong}/{boss.idealTeam ?? 5} no nível {boss.teamLevel != null ? pt.format(boss.teamLevel) : "?"} · dano recebido ×{pen.mult >= 10 ? pt.format(Math.round(pen.mult)) : pen.mult.toFixed(2).replace(".", ",")}
            </p>
          )}

          {inThis && running && !a.arena && (
            <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: VIOLET }} aria-live="polite">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {PHASE_LABEL[a.run!.phase]}…
            </p>
          )}
          {inThis ? (
            <button type="button" className="btn min-h-12 w-full !border-[#7a3030] text-base !text-poke-red" disabled={busy} onClick={() => window.confirm("Abandonar a luta? A conta cura no Centro e volta para a hunt.") && void run(() => bossApi.leave(a.id))}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogOut className="size-4" aria-hidden />} {a.arena ? "Abandonar a luta" : "Cancelar"}
            </button>
          ) : (
            <button
              type="button"
              className="btn min-h-12 w-full !border-[#b66bff] !bg-[#3a2560] text-base font-extrabold disabled:!border-line disabled:!bg-tile"
              disabled={!canEnter || busy}
              onClick={() => void run(() => bossApi.enter(a.id, boss.key))}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Swords className="size-4" aria-hidden />}
              {!a.online ? "Conta offline" : !levelOk ? `Treinador nv ${pt.format(boss.minTrainerLevel)}+` : inArena ? "Em outra luta" : tokens < (boss.entry?.qty ?? 1) ? "Sem entrada" : "Desafiar"}
            </button>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <OptionTile
              on={autoOnThis}
              icon={<Repeat className="size-4" aria-hidden />}
              title="Repetir automaticamente"
              desc={a.auto && a.autoKey && a.autoKey !== boss.key
                ? `Repetindo ${data.catalog.find((b) => b.key === a.autoKey)?.name ?? a.autoKey}. Ligue aqui para trocar.`
                : `Ao fim de cada luta, cura no Centro e volta. Dá para ${pt.format(tokens)} entradas.`}
              disabled={!a.online || busy || !levelOk}
              onChange={(v) => void run(() => bossApi.auto(a.id, boss.key, v))}
            />
            <OptionTile
              on={a.buyRevive}
              icon={<HeartPulse className="size-4" aria-hidden />}
              title="Comprar Revive"
              desc={`Compra 100 do mais barato quando zerar e liga o auto-revive do jogo. Você tem ${pt.format(a.revives)}.`}
              disabled={busy}
              onChange={(v) => void run(() => bossApi.revive(a.id, v))}
            />
          </div>
        </section>
      )}
      {err && <p className="rounded-md bg-poke-red/10 px-2 py-1 text-xs text-poke-red" role="alert">{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------ resultados
function Recent({ a }: { a: BossAccount }) {
  if (!a.recent.length) return null;
  return (
    <section className="card p-3 sm:p-4" aria-label="Últimas lutas">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide">
        <Flame className="size-4 text-poke-gold" aria-hidden /> Últimas lutas de {a.nick}
        <span className="tnum text-xs font-semibold normal-case text-mute">
          <b className="text-poke-green">{a.session.wins}V</b> / <b className="text-poke-red">{a.session.losses}D</b> nesta sessão
        </span>
      </h3>
      <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto text-sm">
        {a.recent.map((r) => (
          <li key={r.at} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-line bg-tile px-2 py-1">
            <b style={{ color: r.won ? "#6fd47c" : "#ef6b5b" }}>{r.won ? "Vitória" : "Derrota"}</b>
            <span className="font-semibold">{r.name}</span>
            {r.won && (
              <span className="text-xs text-mute">
                {r.drops.length ? r.drops.map((d) => `${d.name ?? "item"}×${d.qty}`).join(", ") : "sem drops"}
              </span>
            )}
            <time className="tnum ml-auto text-[11px] text-mute" dateTime={new Date(r.at).toISOString()}>
              {new Date(r.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --------------------------------------------------------------------- aba
export function BossView() {
  const { data, error, refresh } = useBosses();
  const [accId, setAccId] = useState<number | null>(null);
  const [selected, setSelected] = useState("");
  const [view, setView] = useState<"bosses" | "arena">("bosses");
  const [summaryOf, setSummaryOf] = useState<number | null>(null);
  const accounts = data?.accounts ?? [];
  const inArena = accounts.filter((x) => x.active).length;
  const a = accounts.find((x) => x.id === accId) ?? accounts[0];
  const catalog = data?.catalog ?? [];
  const raidOn = (selected === RAID_KEY || selected === "") && !!data?.raid;   // como no jogo: abre no Raid da semana
  const boss = catalog.find((b) => b.key === selected) ?? catalog.find((b) => b.playable) ?? catalog[0];
  const tokenEntry = catalog.find((b) => b.entry)?.entry ?? null;

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <section className="card flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-3 sm:p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-extrabold sm:text-lg">
            <Swords className="size-5" style={{ color: VIOLET }} aria-hidden /> Bosses
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-mute sm:text-sm">
            Arenas de desafio: três bosses por região, cada um com o seu prêmio. Cada boss cobra uma entrada e luta sempre no nível dele, com qualquer equipe. Ele bate mais forte quanto mais fraca for a sua equipe: leve 5 Pokémon com pelo menos o nível do boss para anular a penalidade.
          </p>
        </div>
        {accounts.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Conta">
            {accounts.map((x) => {
              const on = x.id === a?.id;
              return (
                <button key={x.id} type="button" aria-pressed={on && view === "bosses"} onClick={() => { setAccId(x.id); setView("bosses"); }} className={`btn min-h-9 gap-1.5 ${on && view === "bosses" ? "!border-[#b66bff] !bg-[#2e1f45]" : ""}`}>
                  <span className={`size-2 rounded-full ${x.arena ? "bg-poke-gold" : x.online ? "bg-poke-green" : "bg-mute/50"}`} aria-hidden />
                  {x.nick}
                  {x.arena ? <span className="text-[10px] font-extrabold text-poke-gold">NA ARENA</span> : x.auto ? <Repeat className="size-3 text-[#b66bff]" aria-label="repetindo" /> : null}
                </button>
              );
            })}
            <button type="button" aria-pressed={view === "arena"} onClick={() => setView(view === "arena" ? "bosses" : "arena")} className={`btn min-h-9 gap-1.5 ${view === "arena" ? "!border-[#f3c04a] !bg-[#38290f] text-poke-gold" : ""}`}>
              <Flame className="size-4" aria-hidden /> Arena
              {inArena > 0 && <span className="tnum rounded-full bg-poke-gold px-1.5 text-[11px] font-extrabold leading-4 text-void">{inArena}</span>}
            </button>
          </div>
        )}
      </section>

      {error && !data && <p className="rounded-md bg-poke-red/10 px-3 py-2 text-sm text-poke-red" role="alert">{error}</p>}
      {!data && !error && <p className="py-10 text-center text-mute">Carregando os bosses…</p>}
      {data && catalog.length === 0 && (
        <p className="py-10 text-center text-mute">O catálogo de bosses chega quando uma conta conecta. Ligue uma conta para ver as arenas.</p>
      )}

      {data && view === "arena" && <ArenaView data={data} onChanged={refresh} onSummary={setSummaryOf} />}

      {data && (boss || data.raid) && view === "bosses" && (
        <div className="card grid gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          <BossList catalog={catalog} selected={raidOn ? RAID_KEY : boss?.key ?? ""} onSelect={setSelected} wins={a?.wins ?? {}} raid={data.raid} />
          {raidOn && data.raid ? <RaidFicha raid={data.raid} a={a} token={tokenEntry} onChanged={refresh} /> : boss ? <Ficha boss={boss} a={a} data={data} onChanged={refresh} /> : null}
        </div>
      )}

      {a && view === "bosses" && <Recent a={a} />}
      {data && <SummaryModal data={data} forced={summaryOf} onClose={() => setSummaryOf(null)} />}
    </div>
  );
}

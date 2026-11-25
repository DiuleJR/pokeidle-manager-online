import { AnimatePresence, motion } from "framer-motion";
import { Repeat, Swords, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BossArt, EASE, HpBar, pt, Switch, VIOLET } from "@/components/bossUi";
import { ItemSprite } from "@/components/Sprites";
import {
  bossApi,
  PHASE_LABEL,
  rarityOf,
  RARITY_COLOR,
  type Boss,
  type BossAccount,
  type BossOverview,
  type BossSeries,
} from "@/lib/boss";

interface Tile {
  itemId: number | null;
  name: string;
  icon: string | null;
  qty: number;
  chance: number | null;
}

/**
 * Os prêmios do boss em quadradinhos: cinza enquanto nada caiu, colorido com a quantidade no cantinho quando caiu.
 * Entram também itens que caíram e não estão na lista de hoje (o prêmio gira todo dia às 18h).
 */
function tilesFor(boss: Boss | undefined, series: BossSeries | null): Tile[] {
  const got = new Map((series?.items ?? []).map((i) => [i.itemId, i]));
  const rows: Tile[] = (boss?.days[0]?.drops ?? []).map((d) => ({ itemId: d.itemId, name: d.name, icon: d.icon, chance: d.chance, qty: got.get(d.itemId)?.qty ?? 0 }));
  const listed = new Set(rows.map((r) => r.itemId));
  for (const i of series?.items ?? []) if (!listed.has(i.itemId)) rows.push({ itemId: i.itemId, name: i.name, icon: i.icon, chance: null, qty: i.qty });
  return rows;
}

function DropTile({ t }: { t: Tile }) {
  const got = t.qty > 0;
  const rar = rarityOf(t.chance);
  const rare = got && (rar === "rara" || rar === "mitica" || rar === "lendaria");
  const color = RARITY_COLOR[rar];
  return (
    <span
      className="relative inline-flex size-12 items-center justify-center rounded-lg border bg-tile"
      style={{ borderColor: rare ? color : "#3b2b17", boxShadow: rare ? `0 0 12px -2px ${color}` : undefined }}
      title={got ? `${t.name}: ${pt.format(t.qty)} caíram` : `${t.name}: ainda não caiu`}
    >
      <span className={got ? "" : "opacity-40 grayscale"}>
        <ItemSprite icon={t.icon} size={34} alt={t.name} />
      </span>
      {got && (
        <b className="tnum absolute -bottom-1.5 -right-1.5 min-w-5 rounded-full border border-black/40 bg-poke-gold px-1 text-center text-[11px] font-extrabold leading-5 text-void">
          {pt.format(t.qty)}
        </b>
      )}
    </span>
  );
}

/** Quanto foi gasto de um item nesta série (com o sprite dele) e quanto ainda resta. */
export function SpendTile({ icon, label, spent, left }: { icon?: string | null; label: string; spent: number; left: number }) {
  const out = left <= 0;
  return (
    <div className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${out ? "border-[#7a3030] bg-[#2a1212]" : "border-line bg-tile"}`} title={`${label}: ${pt.format(spent)} gastos, ${pt.format(left)} restam`}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-black/30"><ItemSprite icon={icon} size={30} alt="" /></span>
      <span className="min-w-0 leading-tight">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-mute">{label}</span>
        <span className="tnum flex flex-wrap items-baseline gap-x-1.5">
          <b className="text-lg" style={{ color: spent > 0 ? "#f3b13a" : undefined }}>−{pt.format(spent)}</b>
          <span className={`text-xs ${out ? "font-bold text-poke-red" : "text-mute"}`}>{out ? "acabou" : `restam ${pt.format(left)}`}</span>
        </span>
      </span>
    </div>
  );
}

function phaseOf(a: BossAccount): { label: string; tone: string } {
  if (a.run?.phase === "failed") return { label: PHASE_LABEL.failed, tone: "#ef6b5b" };
  if (a.arena) return { label: a.auto ? "Lutando · repetindo" : "Lutando", tone: "#f3c04a" };
  if (a.run && !a.run.finished) return { label: PHASE_LABEL[a.run.phase], tone: VIOLET };
  if (a.auto) return { label: "Repetindo · entre as lutas", tone: "#f3c04a" };
  return { label: "Parado", tone: "#b39a6e" };
}

function ArenaCard({ a, data, onChanged, onSummary }: { a: BossAccount; data: BossOverview; onChanged: () => Promise<void>; onSummary: (id: number) => void }) {
  const [busy, setBusy] = useState(false);
  const key = a.arena?.key ?? a.run?.key ?? a.series?.key ?? a.autoKey;
  const boss = data.catalog.find((b) => b.key === key);
  const tiles = useMemo(() => tilesFor(boss, a.series), [boss, a.series]);
  const dropped = tiles.reduce((n, t) => n + t.qty, 0);
  const tokensLeft = boss?.entry?.itemId != null ? a.items[String(boss.entry.itemId)] ?? 0 : 0;
  const ph = phaseOf(a);
  const running = !!a.arena || (!!a.run && !a.run.finished) || a.auto;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.article initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="card flex min-w-0 flex-col gap-3 p-3 sm:p-4" aria-label={`Arena de ${a.nick}`}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="truncate text-base font-extrabold">{a.nick}</h3>
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold" style={{ borderColor: ph.tone, color: ph.tone }}>
          {running && <span className="size-1.5 animate-pulse rounded-full" style={{ background: ph.tone }} aria-hidden />}
          {ph.label}
        </span>
      </header>

      <div className="flex items-center gap-3">
        <span className="shrink-0 rounded-lg bg-black/25 p-1">{boss ? <BossArt boss={boss} size={72} /> : <Swords className="size-10 text-mute" aria-hidden />}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-extrabold leading-tight">{boss?.name ?? a.arena?.name ?? "Boss"}</div>
          <div className="tnum mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span title="Vitórias e derrotas desta série"><b className="text-poke-green">{a.series?.wins ?? 0}</b> <span className="text-xs text-mute">vitórias</span> · <b className="text-poke-red">{a.series?.losses ?? 0}</b> <span className="text-xs text-mute">derrotas</span></span>
            <span title="Itens que caíram do boss nesta série"><b className="text-poke-gold">{pt.format(dropped)}</b> <span className="text-xs text-mute">drops</span></span>
          </div>
        </div>
      </div>

      {a.hp ? <HpBar hp={a.hp.hp} maxHp={a.hp.maxHp} /> : a.arena ? <p className="text-xs text-mute">Esperando o jogo informar a vida do boss…</p> : null}

      <div className="grid grid-cols-2 gap-2" aria-label="Gastos desta série">
        <SpendTile icon={boss?.entry?.icon} label="Fichas" spent={a.series?.tokens ?? 0} left={tokensLeft} />
        <SpendTile icon={data.revive?.icon} label="Revives" spent={a.series?.revives ?? 0} left={a.revives} />
      </div>

      {tiles.length > 0 && (
        <div className="flex flex-wrap gap-2.5 pb-1" aria-label="Drops">
          {tiles.map((t, i) => <DropTile key={`${t.itemId}-${i}`} t={t} />)}
        </div>
      )}

      {a.run?.error && <p className="rounded-md bg-poke-red/10 px-2 py-1 text-xs text-poke-red" role="alert">{a.run.error}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2">
        {key && (
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
            <Repeat className="size-3.5" aria-hidden /> Repetir
            <Switch on={a.auto && a.autoKey === key} label="Repetir automaticamente" disabled={busy || !a.online} onChange={(v) => void act(() => bossApi.auto(a.id, key, v))} />
          </label>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold" title="Compra 100 Revives quando zerar e liga o auto-revive do jogo">
          Revive <span className="tnum text-mute">({pt.format(a.revives)})</span>
          <Switch on={a.buyRevive} label="Comprar Revive automaticamente" disabled={busy} onChange={(v) => void act(() => bossApi.revive(a.id, v))} />
        </label>
        {a.summary && !running && (
          <button type="button" className="btn ml-auto min-h-9" onClick={() => onSummary(a.id)}>
            <Trophy className="size-4 text-poke-gold" aria-hidden /> Ver resumo
          </button>
        )}
      </div>
    </motion.article>
  );
}

/** Aba "Arena": um cartão por conta que está lutando contra boss (ou acabou de lutar). */
export function ArenaView({ data, onChanged, onSummary }: { data: BossOverview; onChanged: () => Promise<void>; onSummary: (id: number) => void }) {
  const active = data.accounts.filter((a) => a.active);
  const idle = data.accounts.filter((a) => !a.active && a.summary);
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {active.length === 0 && (
        <section className="card p-4 text-center text-sm text-mute">
          Nenhuma conta está em um boss agora. Escolha um boss na aba <b className="text-fg">Bosses</b> e toque em Desafiar.
        </section>
      )}
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        {active.map((a) => <ArenaCard key={a.id} a={a} data={data} onChanged={onChanged} onSummary={onSummary} />)}
      </div>
      {idle.length > 0 && (
        <section className="card p-3 sm:p-4" aria-label="Últimos resumos">
          <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wide">Últimos resumos</h3>
          <ul className="flex flex-col gap-1.5">
            {idle.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-tile px-2 py-1.5 text-sm">
                <b>{a.nick}</b>
                <span className="text-mute">{a.summary!.name} · <span className="tnum">{a.summary!.wins}</span> vitórias · <span className="tnum">{a.summary!.tokens}</span> fichas</span>
                <button type="button" className="btn ml-auto min-h-8" onClick={() => onSummary(a.id)}>Ver resumo</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ resumo
const seenKey = (id: number) => `boss-summary-seen:${id}`;
const readSeen = (id: number) => {
  try {
    return Number(localStorage.getItem(seenKey(id))) || 0;
  } catch {
    return 0;
  }
};
const writeSeen = (id: number, at: number) => {
  try {
    localStorage.setItem(seenKey(id), String(at));
  } catch {
    /* sem armazenamento: só mostra de novo */
  }
};
const FRESH_MS = 30 * 60_000;

/** "Resumo dos bosses": abre sozinho quando uma série acaba (se a aba estiver aberta) ou quando o usuário pede. */
export function SummaryModal({ data, forced, onClose }: { data: BossOverview; forced: number | null; onClose: () => void }) {
  const [dismissed, setDismissed] = useState<Record<number, number>>({});
  const auto = data.accounts.find((a) => a.summary?.endedAt && Date.now() - a.summary.endedAt < FRESH_MS && (dismissed[a.id] ?? readSeen(a.id)) < a.summary.endedAt);
  const a = (forced != null ? data.accounts.find((x) => x.id === forced) : undefined) ?? auto;
  const s = a?.summary;
  const close = () => {
    if (a && s?.endedAt) {
      writeSeen(a.id, s.endedAt);
      setDismissed((d) => ({ ...d, [a.id]: s.endedAt! }));
    }
    onClose();
  };
  useEffect(() => {
    if (!s) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.endedAt, a?.id]);

  const boss = data.catalog.find((b) => b.key === s?.key);
  const tiles = useMemo(() => (s ? tilesFor(boss, s) : []), [boss, s]);
  if (!a || !s) return null;
  return createPortal(
    <AnimatePresence>
      {a && s && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} onClick={close} role="presentation">
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="boss-summary-title"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.15 } }}
            transition={{ duration: 0.25, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            className="card max-h-[90dvh] w-full max-w-sm overflow-y-auto overscroll-contain p-4 text-center sm:p-5"
          >
            <h2 id="boss-summary-title" className="mx-auto inline-block rounded-lg border border-[#b66bff] bg-[#3a2560] px-4 py-1 text-base font-extrabold uppercase tracking-wide">Resumo dos bosses</h2>
            <p className="mt-3 text-sm text-mute">
              {a.nick}: em <b className="tnum text-fg">{pt.format(s.wins)}</b> {s.wins === 1 ? "vitória" : "vitórias"} contra {s.name ?? "bosses"} você conseguiu:
            </p>
            <ul className="mt-2 flex flex-col gap-1 rounded-xl border border-line bg-tile p-2 text-left">
              {tiles.length === 0 && <li className="py-2 text-center text-sm text-mute">Nenhum drop desta vez.</li>}
              {tiles.map((t, i) => (
                <li key={`${t.itemId}-${i}`} className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${t.qty ? "" : "opacity-45 grayscale"}`}>
                  <ItemSprite icon={t.icon} size={32} alt="" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t.name}</span>
                  <b className="tnum text-base text-poke-gold">×{pt.format(t.qty)}</b>
                </li>
              ))}
            </ul>
            <div className="mt-2 grid grid-cols-2 gap-2 text-left">
              <SpendTile icon={boss?.entry?.icon} label="Fichas" spent={s.tokens} left={a.items[String(boss?.entry?.itemId)] ?? 0} />
              <SpendTile icon={data.revive?.icon} label="Revives" spent={s.revives} left={a.revives} />
            </div>
            {s.losses > 0 && <p className="tnum mt-2 text-sm text-mute">Derrotas: <b className="text-poke-red">{s.losses}</b></p>}
            <p className="mt-1 text-sm font-semibold">{s.reason === "failed" ? "A luta foi interrompida." : "A repetição automática terminou."}</p>
            <button type="button" autoFocus className="btn mt-4 min-h-11 w-full !border-[#b66bff] !bg-[#3a2560] text-base font-extrabold" onClick={close}>Show!</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

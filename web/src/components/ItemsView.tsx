import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { ItemSprite } from "@/components/Sprites";
import { AnimatedNumber } from "@/components/ui";
import { useAccountIds, useAccountsMap } from "@/lib/telemetry";
import { fmtShort } from "@/lib/utils";

type Group = "potions" | "balls" | "stones" | "others";
const GROUPS: { id: Group; label: string }[] = [
  { id: "potions", label: "Potions" },
  { id: "balls", label: "Balls" },
  { id: "stones", label: "Stones" },
];

const EASE = [0.22, 1, 0.36, 1] as const;

const groupOf = (category: string): Group =>
  category === "ball" ? "balls" : category === "heal" || category === "revive" ? "potions" : category === "stone" ? "stones" : "others";

interface PerAccount {
  id: string;
  nick: string;
  qty: number;
}
interface Row {
  key: string;
  name: string;
  group: Group;
  rare: boolean;
  icon?: string | null;
  qty: number;
  per: PerAccount[];
}

/**
 * Item do inventário.
 * - Item em várias contas: passar o mouse (ou tocar, no celular) vira o bloco numa lista com a quantidade de cada conta.
 * - Item em uma conta só: o nome da conta aparece embaixo da quantidade.
 */
function ItemTile({ row, showAccounts, index }: { row: Row; showAccounts: boolean; index: number }) {
  const multi = showAccounts && row.per.length > 1;
  const single = showAccounts && row.per.length === 1 ? row.per[0] : null;
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const lastPointer = useRef("mouse");
  const open = multi && (hover || pinned);

  // Toque fora do bloco fecha a lista fixada.
  useEffect(() => {
    if (!pinned) return;
    const on = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", on);
    return () => document.removeEventListener("pointerdown", on);
  }, [pinned]);

  const sorted = useMemo(() => [...row.per].sort((a, b) => b.qty - a.qty), [row.per]);

  return (
    <motion.li
      ref={ref}
      layout
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
      transition={{ duration: 0.35, ease: EASE, delay: Math.min(index, 18) * 0.018 }}
      whileHover={{ y: -3, transition: { duration: 0.18, ease: EASE } }}
      whileTap={multi ? { scale: 0.97 } : undefined}
      onPointerDown={(e) => (lastPointer.current = e.pointerType)}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
      onClick={() => multi && lastPointer.current !== "mouse" && setPinned((p) => !p)}
      onKeyDown={(e) => multi && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setPinned((p) => !p))}
      role={multi ? "button" : undefined}
      tabIndex={multi ? 0 : undefined}
      aria-expanded={multi ? open : undefined}
      aria-label={multi ? `${row.name}: ver quantidade por conta` : undefined}
      className={`tile relative flex min-h-[104px] select-none flex-col items-center justify-center px-1.5 py-2 text-center sm:min-h-[132px] sm:px-2 sm:py-3 ${
        multi ? "cursor-pointer" : ""
      } ${open ? "z-20 !border-edge" : ""}`}
    >
      {row.rare && (
        <span className="absolute right-1.5 top-1 text-xs text-poke-gold sm:text-sm" title="Item raro">
          ★
        </span>
      )}
      {multi && (
        <span aria-hidden className="absolute left-1.5 top-1.5 rounded bg-black/40 px-1 text-[9px] font-bold leading-4 text-mute sm:text-[10px]">
          {row.per.length}
        </span>
      )}

      <div className="flex size-10 items-center justify-center rounded-xl border border-line bg-void sm:size-12">
        <ItemSprite icon={row.icon} size={34} alt={row.name} />
      </div>
      <div className="mt-1.5 line-clamp-2 min-h-[2rem] break-words text-xs font-semibold leading-tight sm:mt-2 sm:min-h-[2.5rem] sm:text-base">
        {row.name}
      </div>
      <div className="text-lg font-extrabold leading-none sm:text-2xl">
        <AnimatedNumber value={row.qty} format={fmtShort} />
      </div>
      {single && <div className="mt-1 max-w-full truncate text-[11px] font-medium text-mute sm:text-sm">{single.nick}</div>}

      <AnimatePresence>
        {open && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: EASE }}
            className="absolute inset-x-0 top-0 z-10 flex min-h-full flex-col justify-center gap-0.5 rounded-[9px] border border-edge bg-[#1d140b] px-1.5 py-1.5 text-left shadow-[0_8px_24px_-6px_rgba(0,0,0,.8)] sm:gap-1 sm:px-3"
          >
            <div className="hidden truncate text-[10px] font-semibold uppercase tracking-wide text-mute sm:block sm:text-xs">{row.name}</div>
            {sorted.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.04 + i * 0.04, duration: 0.2, ease: EASE }}
                className="flex items-baseline justify-between gap-1 text-[11px] sm:gap-2 sm:text-sm"
              >
                <span className="min-w-0 truncate text-fg/90">{p.nick}</span>
                <span className="tnum shrink-0 font-bold">{fmtShort(p.qty)}</span>
              </motion.div>
            ))}
            <div className="mt-0.5 flex justify-between gap-1 border-t border-line pt-0.5 text-[11px] font-extrabold text-poke-gold sm:gap-2 sm:text-sm">
              <span>Total</span>
              <span className="tnum">{fmtShort(row.qty)}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** Itens (e balls) de uma conta ou de todas juntas, com sprites, filtros e detalhe por conta. */
export function ItemsView({ account }: { account: string }) {
  const accounts = useAccountsMap();
  const ids = useAccountIds();
  const [query, setQuery] = useState("");
  const [onlyRare, setOnlyRare] = useState(false);
  const [group, setGroup] = useState<Group | "all">("all");

  const rows = useMemo(() => {
    const map = new Map<string, Row>();
    const add = (key: string, name: string, g: Group, rare: boolean, icon: string | null | undefined, qty: number, accId: string) => {
      const r = map.get(key) ?? { key, name, group: g, rare, icon, qty: 0, per: [] };
      r.qty += qty;
      r.per.push({ id: accId, nick: accounts[accId]?.nick ?? accId, qty });
      map.set(key, r);
    };
    for (const id of ids) {
      if (account !== "all" && account !== id) continue;
      const a = accounts[id];
      if (!a?.inventory) continue;
      for (const b of a.inventory.balls) if (b.qty > 0) add(`b${b.id}`, b.name, "balls", false, b.icon, b.qty, id);
      for (const i of a.inventory.items)
        if (i.qty > 0) add(`i${i.id}`, i.name, groupOf(i.category ?? "loot"), !!i.rare, i.icon, i.qty, id);
    }
    return [...map.values()];
  }, [accounts, ids, account]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (!onlyRare || r.rare) && (group === "all" || r.group === group) && (!q || r.name.toLowerCase().includes(q)))
      .sort((a, b) => b.qty - a.qty);
  }, [rows, query, onlyRare, group]);

  const showAccounts = account === "all";

  return (
    <div className="card p-2.5 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input className="field w-full sm:w-64" placeholder="Buscar item" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="-mx-0.5 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-0.5 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          <button className="btn shrink-0" data-active={group === "all"} onClick={() => setGroup("all")}>
            Todos
          </button>
          {GROUPS.map((g) => (
            <button key={g.id} className="btn shrink-0" data-active={group === g.id} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
          <button className="btn shrink-0 sm:ml-auto" data-active={onlyRare} onClick={() => setOnlyRare((v) => !v)}>
            ★ Raros
          </button>
        </div>
      </div>

      <div className="mt-2.5 border-t border-line pt-2.5 sm:mt-3 sm:pt-3">
        {shown.length === 0 ? (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-10 text-center text-mute">
            Nenhum item com esses filtros.
          </motion.p>
        ) : (
          <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 xl:grid-cols-7">
            <AnimatePresence mode="popLayout" initial>
              {shown.map((r, i) => (
                <ItemTile key={r.key} row={r} showAccounts={showAccounts} index={i} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

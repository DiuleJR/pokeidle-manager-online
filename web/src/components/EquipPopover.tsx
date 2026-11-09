import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ItemSprite } from "@/components/Sprites";
import { actions } from "@/lib/actions";
import type { EquippedItem } from "@/lib/types";
import { fmtInt } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;
const W = 288;
const BEAST_BALL = 5; // não é vendida na loja: o bot não consegue repor

/** Lista de poções ou bolas para trocar a equipada. Abre ancorada no bloco clicado (fora do card, para não ser cortada). */
export function EquipPopover({
  kind,
  accId,
  options,
  selectedId,
  anchor,
  onClose,
}: {
  kind: "ball" | "potion";
  accId: string;
  options: EquippedItem[];
  selectedId?: number;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const label = kind === "ball" ? "Bola" : "Poção";

  useEffect(() => {
    const out = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", out);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", out);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const height = options.length * 52 + 78;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - W - 8));
  const below = anchor.bottom + 6 + height <= window.innerHeight;
  const top = below ? anchor.bottom + 6 : Math.max(8, anchor.top - 6 - height);

  const pick = async (o: EquippedItem) => {
    if (busy !== null) return;
    if (o.id === selectedId) return onClose();
    setBusy(o.id);
    setNote(null);
    try {
      const r = await actions.equip(accId, kind, o.id);
      if (r.willBuy) setNote({ tone: "ok", text: `${o.name} equipada. Sem estoque suficiente: o bot vai comprar.` });
      else if (!r.buyable && r.stock === 0) setNote({ tone: "warn", text: `${o.name} equipada, mas não é vendida na loja e o estoque acabou.` });
      else if (!r.restockEnabled && r.stock === 0) setNote({ tone: "warn", text: `${o.name} equipada, mas a reposição automática desta conta está desligada.` });
      else setNote({ tone: "ok", text: `${o.name} equipada.` });
      setTimeout(onClose, 1400);
    } catch (e) {
      setNote({ tone: "err", text: e instanceof Error ? e.message : "Não foi possível trocar." });
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={`Trocar ${label.toLowerCase()} equipada`}
      initial={{ opacity: 0, y: below ? -6 : 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
      transition={{ duration: 0.18, ease: EASE }}
      style={{ left, top, width: W, transformOrigin: below ? "top left" : "bottom left" }}
      className="card fixed z-[60] p-2"
    >
      <div className="px-1.5 pb-1.5 pt-0.5 text-xs font-bold uppercase tracking-wide text-mute">{label} equipada</div>
      <ul className="space-y-1">
        {options.map((o) => {
          const on = o.id === selectedId;
          const empty = o.qty <= 0;
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void pick(o)}
                aria-pressed={on}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors duration-150 disabled:opacity-60 ${
                  on ? "border-edge bg-[#3a2a12]" : "border-line bg-tile hover:border-edge/70 hover:bg-[#241a0f]"
                }`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center">
                  <ItemSprite icon={o.icon} size={30} alt="" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold leading-tight">{o.name}</span>
                  <span className={`block text-xs ${empty ? "text-poke-red" : "text-mute"}`}>
                    {empty ? (kind === "ball" && o.id === BEAST_BALL ? "sem estoque" : "sem estoque · o bot compra") : <>em estoque: <span className="tnum">{fmtInt(o.qty)}</span></>}
                  </span>
                </span>
                {busy === o.id ? <Loader2 className="size-4 shrink-0 animate-spin text-poke-gold" aria-hidden /> : on ? <Check className="size-4 shrink-0 text-poke-gold" aria-hidden /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <AnimatePresence>
        {note && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            role={note.tone === "err" ? "alert" : "status"}
            className={`mt-1.5 overflow-hidden px-1.5 text-xs ${note.tone === "err" ? "text-poke-red" : note.tone === "warn" ? "text-poke-gold" : "text-poke-green"}`}
          >
            {note.text}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>,
    document.body,
  );
}

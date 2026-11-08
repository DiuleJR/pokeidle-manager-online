import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect } from "react";
import { fmtShort } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Número que "rola" até o novo valor (ease-out exponencial), sem re-render do React por frame. */
export function AnimatedNumber({ value, format = fmtShort }: { value: number; format?: (n: number) => string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(Math.round(v)));
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.8, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, mv]);
  return <motion.span className="tnum">{text}</motion.span>;
}

const CORNER = "M2 2 L2 26 Q2 30 6 30 M2 2 L26 2 Q30 2 30 6 M8 8 L8 16 M8 8 L16 8";

/** Moldura do painel: borda dourada dupla + ornamentos nos 4 cantos. */
export function Frame({ children }: { children: React.ReactNode }) {
  const corner = (cls: string) => (
    <svg aria-hidden viewBox="0 0 32 32" className={`pointer-events-none absolute size-5 text-edge sm:size-8 ${cls}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d={CORNER} />
      <path d="M12 12 l3 3 l-3 3 l-3 -3 z" fill="currentColor" stroke="none" />
    </svg>
  );
  return (
    <div
      className="relative mx-auto w-full max-w-7xl rounded-2xl border-[3px] border-[#8a5f22] px-2.5 pb-4 pt-3 sm:rounded-[22px] sm:px-8 sm:pb-6 sm:pt-7"
      style={{
        background: "linear-gradient(180deg, rgba(36,26,15,.75), rgba(18,12,7,.85))",
        boxShadow: "inset 0 0 0 1px #3b2b17, inset 0 0 60px rgba(0,0,0,.45), 0 20px 60px -20px rgba(0,0,0,.8)",
      }}
    >
      {corner("left-1 top-1")}
      {corner("right-1 top-1 rotate-90")}
      {corner("bottom-1 right-1 rotate-180")}
      {corner("bottom-1 left-1 -rotate-90")}
      {children}
    </div>
  );
}

/**
 * Diálogo de confirmação para ações irreversíveis (ex.: vender o Depot).
 * Fecha com Esc, clique no fundo, ou os botões; `busy` desativa os botões
 * e troca o texto de confirmação por um aviso de execução em andamento.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  busy = false,
  busyLabel = "Enviando…",
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          transition={{ duration: 0.2 }}
          onClick={() => !busy && onCancel()}
          role="presentation"
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.15 } }}
            transition={{ duration: 0.25, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            className="card w-full max-w-sm p-4 sm:p-5"
          >
            <h2 id="confirm-title" className="text-lg font-extrabold leading-tight sm:text-xl">
              {title}
            </h2>
            <div className="mt-2 text-sm leading-relaxed text-mute sm:text-base">{message}</div>
            <div className="mt-4 flex justify-end gap-2 sm:mt-5">
              <button className="btn" onClick={onCancel} disabled={busy}>
                {cancelLabel}
              </button>
              <button
                className={`btn border-0 font-bold text-void ${danger ? "bg-poke-red hover:bg-[#f4806f]" : "bg-poke-gold hover:bg-[#f6ca5e]"}`}
                onClick={onConfirm}
                disabled={busy}
              >
                {busy ? busyLabel : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Ícones de moeda do próprio jogo (pixel art). */
const SITE = "https://pokeidle.io";
export function Coin({ kind, size = 28 }: { kind: "gold" | "gem"; size?: number }) {
  return (
    <img
      src={`${SITE}/midia/${kind === "gold" ? "moeda-ouro" : "moeda-gema"}.png`}
      alt={kind === "gold" ? "Gold" : "Gemas"}
      width={size}
      height={size}
      style={{ width: size, height: size, maxWidth: "100%", maxHeight: "100%", imageRendering: "pixelated", objectFit: "contain" }}
    />
  );
}

/** Moeda de ouro com seta verde: ganho de ouro por hora. */
export function GoldPerHourIcon({ size }: { size?: number }) {
  return (
    <span className="relative flex size-full items-center justify-center">
      <Coin kind="gold" size={size} />
      <span className="absolute -right-0.5 -top-1 rounded-full bg-poke-green px-0.5 text-[8px] font-black leading-none text-void sm:-right-1 sm:text-[10px]">▲</span>
    </span>
  );
}

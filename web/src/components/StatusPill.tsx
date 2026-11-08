import type { AccountStatus } from "@/lib/types";

const MAP: Record<AccountStatus, { label: string; box: string; dot: string; pulse: boolean }> = {
  online: { label: "Conectado", box: "sm:border-[#2f6b3a] sm:bg-[#16301c] text-poke-green", dot: "bg-poke-green", pulse: true },
  paused_cooldown: { label: "Pausado", box: "sm:border-[#7a5a1c] sm:bg-[#33260e] text-poke-gold", dot: "bg-poke-gold", pulse: false },
  offline: { label: "Offline", box: "sm:border-[#7a2f27] sm:bg-[#32140f] text-poke-red", dot: "bg-poke-red", pulse: false },
};

/** Celular: só a bolinha colorida. Desktop (sm+): selo com texto. */
export function StatusPill({ status }: { status: AccountStatus }) {
  const s = MAP[status];
  return (
    <span
      title={s.label}
      aria-label={s.label}
      className={`inline-flex shrink-0 items-center gap-2 text-xs font-bold uppercase tracking-wide transition-colors duration-300 sm:whitespace-nowrap sm:rounded-lg sm:border sm:px-2.5 sm:py-1 ${s.box}`}
    >
      <span className={`size-3 rounded-full sm:size-2 ${s.dot} ${s.pulse ? "animate-pulseDot" : ""}`} />
      <span className="hidden sm:inline">{s.label}</span>
    </span>
  );
}

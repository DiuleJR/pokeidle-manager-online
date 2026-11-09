import { motion } from "framer-motion";
import { useMemo } from "react";
import { Star } from "lucide-react";
import { AnimatedNumber, Coin, GoldPerHourIcon } from "@/components/ui";
import { useAccountsMap } from "@/lib/telemetry";

/** Totais agregados de todas as contas. Celular: 4 chips numa linha só. */
export function SummaryBar() {
  const accounts = useAccountsMap();
  const t = useMemo(() => {
    const list = Object.values(accounts);
    const sum = (f: (a: (typeof list)[number]) => number) => list.reduce((s, a) => s + f(a), 0);
    return {
      xph: sum((a) => (a.status === "online" ? a.xpPerHour : 0)),
      goldh: sum((a) => (a.status === "online" ? a.goldPerHour : 0)),
      gold: sum((a) => a.gold),
      gems: sum((a) => a.gems),
    };
  }, [accounts]);

  const items = [
    { label: "XP/h total", short: "XP/h", value: t.xph, color: "text-poke-green", icon: <Star className="size-full fill-poke-gold text-poke-gold" />, prefix: "+" },
    { label: "Ouro/h total", short: "Ouro/h", value: t.goldh, color: "text-poke-gold", icon: <GoldPerHourIcon size={22} />, prefix: "+" },
    { label: "Gold total", short: "Gold", value: t.gold, color: "text-fg", icon: <Coin kind="gold" size={22} />, prefix: "" },
    { label: "Gemas totais", short: "Gemas", value: t.gems, color: "text-fg", icon: <Coin kind="gem" size={22} />, prefix: "" },
  ];

  return (
    <section aria-label="Totais" className="grid grid-cols-4 gap-1.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
      {items.map((i, n) => (
        <motion.div
          key={i.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: n * 0.05 }}
          className="tile flex flex-col px-2 py-1.5 sm:flex-row sm:items-center sm:gap-3 sm:px-4 sm:py-2"
        >
          <span className="hidden size-9 shrink-0 items-center justify-center sm:flex">{i.icon}</span>
          <div className="min-w-0">
            <div className="label flex items-center gap-1 text-[10px] sm:text-sm">
              <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center sm:hidden">{i.icon}</span>
              <span className="truncate sm:hidden">{i.short}</span>
              <span className="hidden sm:inline">{i.label}</span>
            </div>
            <div className={`mt-1 truncate text-sm font-extrabold leading-none sm:mt-1.5 sm:text-2xl ${i.color}`}>
              {i.prefix}
              <AnimatedNumber value={i.value} />
            </div>
          </div>
        </motion.div>
      ))}
    </section>
  );
}

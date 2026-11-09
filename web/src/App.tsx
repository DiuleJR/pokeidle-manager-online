import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "framer-motion";
import { LayoutDashboard, Package, Settings, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountCard, type CardMode } from "@/components/AccountCard";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import { AccountSelect, InventoryView } from "@/components/InventoryView";
import { MarketView } from "@/components/market/MarketView";
import { SettingsView } from "@/components/SettingsView";
import { SummaryBar } from "@/components/SummaryBar";
import { UpdateBanner } from "@/components/UpdateCard";
import { SupportPopup, SupportSide, SupportStrip } from "@/components/SupportCard";
import { Frame } from "@/components/ui";
import { useAccountIds, useAccountsMap } from "@/lib/telemetry";

type Tab = "dashboard" | "inventario" | "mercado" | "config";
const TABS: { id: Tab; label: string; Icon: typeof Package }[] = [
  { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { id: "inventario", label: "Inventários", Icon: Package },
  { id: "mercado", label: "Mercado", Icon: Store },
  { id: "config", label: "Configurações", Icon: Settings },
];
const MODES: { id: CardMode; label: string }[] = [
  { id: "resumo", label: "Resumo" },
  { id: "sessao", label: "Sessão" },
];

const EASE = [0.22, 1, 0.36, 1] as const;
const readTab = (): Tab =>
  location.hash === "#inventario" ? "inventario" : location.hash === "#mercado" ? "mercado" : location.hash === "#config" ? "config" : "dashboard";
const TITLES: Record<Tab, string> = { dashboard: "Painel de Contas", inventario: "Inventários", mercado: "Mercado", config: "Configurações" };

/** Seletor segmentado com "pílula" que desliza entre as opções. */
function Segmented<T extends string>({
  id,
  className = "",
  options,
  value,
  onChange,
}: {
  id: string;
  className?: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className={`relative flex gap-0.5 rounded-xl border border-line bg-tile p-0.5 sm:gap-1 sm:p-1 ${className}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`relative rounded-lg px-2.5 py-1 text-xs font-semibold sm:px-3.5 sm:py-1.5 sm:text-sm transition-colors duration-200 ${
            value === o.id ? "text-void" : "text-mute hover:text-fg"
          }`}
        >
          {value === o.id && (
            <motion.span
              layoutId={`${id}-pill`}
              className="absolute inset-0 rounded-lg bg-poke-gold"
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function Dashboard({ mode }: { mode: CardMode }) {
  const ids = useAccountIds();
  return (
    <div className="space-y-2.5 sm:space-y-3">
      <SummaryBar />
      {ids.length === 0 ? (
        <p className="card p-10 text-center text-mute">Aguardando dados da VPS…</p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:gap-3 lg:grid-cols-2">
          {ids.map((id, i) => (
            <AccountCard key={id} id={id} mode={mode} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>(readTab);
  const [mode, setMode] = useState<CardMode>("resumo");
  const [account, setAccount] = useState("all");
  const ids = useAccountIds();
  const accounts = useAccountsMap();
  const online = ids.filter((i) => accounts[i]?.status === "online").length;

  useEffect(() => {
    const on = () => setTab(readTab());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  // Toda troca de aba começa no topo (inclusive voltar/avançar do navegador).
  const toTop = () => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  };
  useEffect(() => {
    toTop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const go = (t: Tab) => {
    location.hash = t === "dashboard" ? "" : t;
    setTab(t);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen px-1.5 py-2 pb-24 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-6 sm:py-4 sm:pb-4">
        <Frame>
          <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 sm:gap-y-4">
            <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start">
            <div className="flex items-center gap-2 sm:gap-3.5">
              <img
                src="/icon-192.png"
                alt=""
                aria-hidden
                className="size-8 shrink-0 rounded-lg sm:size-12 sm:rounded-xl"
                style={{ filter: "drop-shadow(0 0 10px rgba(200,146,58,.45))" }}
              />
              <div>
                <h1 className="text-base font-extrabold uppercase leading-none tracking-wide sm:text-3xl">
                  {TITLES[tab]}
                </h1>
                <p className="mt-1 text-xs text-mute sm:mt-1.5 sm:text-sm">
                  <span className="tnum">
                    {online}/{ids.length}
                  </span>{" "}
                  Contas Conectadas
                </p>
              </div>
            </div>
            <div className="sm:hidden">
              <ConnectionIndicator />
            </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5">
              <LayoutGroup id="nav">
                <Segmented id="tab" className="hidden sm:flex" options={TABS} value={tab} onChange={go} />
                {/* Sem animação de saída: o elemento que sai (popLayout) ficava preso por cima das abas. */}
                {tab === "dashboard" ? (
                  <motion.div key="mode" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, ease: EASE }}>
                    <Segmented id="mode" options={MODES} value={mode} onChange={setMode} />
                  </motion.div>
                ) : tab === "inventario" ? (
                  <motion.div key="acc" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, ease: EASE }}>
                    <AccountSelect value={account} onChange={setAccount} />
                  </motion.div>
                ) : null}
              </LayoutGroup>
              <div className="hidden sm:block">
                <ConnectionIndicator />
              </div>
            </div>
          </header>

          <main className="mt-3 sm:mt-4">
            <UpdateBanner />
            <AnimatePresence mode="wait" initial={false} onExitComplete={toTop}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                {tab === "dashboard" ? <Dashboard mode={mode} /> : tab === "inventario" ? <InventoryView account={account} /> : tab === "mercado" ? <MarketView /> : <SettingsView />}
              </motion.div>
            </AnimatePresence>
          </main>
        </Frame>
        {tab !== "config" && <SupportStrip />}
        <SupportSide kind="pix" />
        <SupportSide kind="usdt" />
        <SupportPopup disabled={tab === "config"} />
      </div>

      <nav
        aria-label="Navegação"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-void/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-bold transition-colors ${
              tab === t.id ? "text-poke-gold shadow-[inset_0_2px_0_0_theme(colors.poke.gold)]" : "text-mute"
            }`}
          >
            <t.Icon className="size-5" aria-hidden />
            {t.label}
          </button>
        ))}
      </nav>
    </MotionConfig>
  );
}

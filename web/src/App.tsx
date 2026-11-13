import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "framer-motion";
import { LayoutDashboard, Map as MapIcon, Package, RotateCcw, Settings, Store } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountCard, type CardDrag, type CardMode } from "@/components/AccountCard";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import { AccountSelect, InventoryView } from "@/components/InventoryView";
import { MapaView } from "@/components/MapaView";
import { MarketView } from "@/components/market/MarketView";
import { SettingsView } from "@/components/SettingsView";
import { SummaryBar } from "@/components/SummaryBar";
import { UpdateBanner } from "@/components/UpdateCard";
import { SupportPopup, SupportSide, SupportStrip } from "@/components/SupportCard";
import { ConfirmDialog, Frame } from "@/components/ui";
import { actions } from "@/lib/actions";
import { useAccountIds, useAccountsMap } from "@/lib/telemetry";
import { useCardOrder } from "@/lib/useCardOrder";

type Tab = "dashboard" | "inventario" | "mapa" | "mercado" | "config";
const TABS: { id: Tab; label: string; Icon: typeof Package }[] = [
  { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { id: "inventario", label: "Inventários", Icon: Package },
  { id: "mapa", label: "Mapa", Icon: MapIcon },
  { id: "mercado", label: "Mercado", Icon: Store },
  { id: "config", label: "Configurações", Icon: Settings },
];
const MODES: { id: CardMode; label: string }[] = [
  { id: "resumo", label: "Resumo" },
  { id: "sessao", label: "Sessão" },
];

const EASE = [0.22, 1, 0.36, 1] as const;
const readTab = (): Tab =>
  location.hash === "#inventario" ? "inventario" : location.hash === "#mapa" ? "mapa" : location.hash === "#mercado" ? "mercado" : location.hash === "#config" ? "config" : "dashboard";
const TITLES: Record<Tab, string> = { dashboard: "Painel de Contas", inventario: "Inventários", mapa: "Mapa", mercado: "Mercado", config: "Configurações" };

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

/** Com mouse o card arrasta direto; no celular (sem mouse) só depois de segurar, para o dedo continuar rolando a página. */
const useFinePointer = () => {
  const [fine, setFine] = useState(() => matchMedia("(pointer: fine)").matches);
  useEffect(() => {
    const m = matchMedia("(pointer: fine)");
    const on = () => setFine(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return fine;
};

function Dashboard({ mode }: { mode: CardMode }) {
  const ids = useAccountIds();
  const { order, swap } = useCardOrder(ids);
  const canDrag = useFinePointer();
  const last = useRef({ target: "", at: 0 });

  // Ao passar o card arrastado por cima de outro, os dois trocam de lugar (o outro anima para a vaga).
  const onDragOver = useCallback(
    (id: string, p: { x: number; y: number }) => {
      const hit = document
        .elementsFromPoint(p.x - window.scrollX, p.y - window.scrollY)
        .map((e) => e.closest<HTMLElement>("[data-card-id]"))
        .find((e) => e && e.dataset.cardId !== id);
      const target = hit?.dataset.cardId;
      if (!target) {
        last.current.target = ""; // saiu de cima de qualquer card: pode voltar a trocar com o mesmo
        return;
      }
      const now = performance.now();
      if (target === last.current.target || now - last.current.at < 320) return;
      last.current = { target, at: now };
      swap(id, target);
    },
    [swap],
  );
  const drag: CardDrag = { canDrag, onDragOver };

  return (
    <div className="space-y-2.5 sm:space-y-3">
      <SummaryBar />
      {ids.length === 0 ? (
        <p className="card p-10 text-center text-mute">Aguardando dados da VPS…</p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:gap-3 lg:grid-cols-2">
          {order.map((id, i) => (
            <AccountCard key={id} id={id} mode={mode} index={i} drag={drag} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>(readTab);
  const [mode, setMode] = useState<CardMode>("resumo");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState("");
  const doReset = async () => {
    setResetBusy(true);
    setResetErr("");
    try {
      await actions.resetSession();
      setResetOpen(false);
    } catch (e) {
      setResetErr(e instanceof Error ? e.message : "Não foi possível zerar a sessão.");
    } finally {
      setResetBusy(false);
    }
  };
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
        {/* Barra de abas: fica sempre no mesmo lugar, acima da janela principal (só no computador). */}
        <div className="sticky top-2 z-30 mx-auto mb-3 hidden w-full max-w-7xl items-center justify-between gap-3 sm:flex">
          <LayoutGroup id="nav">
            <Segmented id="tab" options={TABS} value={tab} onChange={go} />
          </LayoutGroup>
          <ConnectionIndicator />
        </div>
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
              <LayoutGroup id="sub">
                {/* Sem animação de saída: o elemento que sai (popLayout) ficava preso por cima das abas. */}
                {tab === "dashboard" ? (
                  <motion.div key="mode" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, ease: EASE }}>
                    <div className="flex items-center gap-1.5 sm:gap-2.5">
                      <Segmented id="mode" options={MODES} value={mode} onChange={setMode} />
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setResetOpen(true)}
                        title="Zerar o tempo, os itens e os shinies da sessão de todas as contas"
                      >
                        <RotateCcw className="size-4" aria-hidden />
                        <span>Zerar sessão</span>
                      </button>
                    </div>
                  </motion.div>
                ) : tab === "inventario" ? (
                  <motion.div key="acc" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, ease: EASE }}>
                    <AccountSelect value={account} onChange={setAccount} />
                  </motion.div>
                ) : null}
              </LayoutGroup>
            </div>
          </header>

          <ConfirmDialog
            open={resetOpen}
            title="Zerar a sessão das contas?"
            busy={resetBusy}
            busyLabel="Zerando…"
            danger={false}
            confirmLabel="Zerar sessão"
            onCancel={() => !resetBusy && setResetOpen(false)}
            onConfirm={() => void doReset()}
            message={
              <>
                O <b className="text-fg">tempo da sessão</b> e os <b className="text-fg">itens coletados e os shinies</b> de todas as contas voltam a zero. Nada muda nas contas nem no jogo.
                {resetErr && <div className="mt-2 text-poke-red">{resetErr}</div>}
              </>
            }
          />

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
                {tab === "dashboard" ? <Dashboard mode={mode} /> : tab === "inventario" ? <InventoryView account={account} /> : tab === "mapa" ? <MapaView /> : tab === "mercado" ? <MarketView /> : <SettingsView />}
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

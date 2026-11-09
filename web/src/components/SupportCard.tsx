import { AnimatePresence, motion } from "framer-motion";
import { Check, Coffee, Copy, QrCode } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// Mesmos dados da seção "Apoie o projeto" do README.
const PIX =
  "00020126580014br.gov.bcb.pix0136d786a417-fce5-4167-9b5f-23614c67b6b25204000053039865802BR5912Diule Junior6009Sao Paulo62230519daqr7556502974044716304D7EB";
const USDT = "EEJYeV16B3Znwy31s66iYzRg6PninPDyLP9eQWnEDa8u";

type Kind = "pix" | "usdt";

/** Falas do Eevee: uma por aparição, em rodízio, para não ficar repetitivo. */
const MESSAGES = [
  "Oi, treinador! Tá gostando do painel? Ele é grátis e de código aberto!",
  "Esse projeto é feito por uma pessoa só. Um cafezinho ajuda a manter as atualizações vindo!",
  "Sem anúncios e sem mensalidade. Se ele te ajudou, que tal retribuir com um Pix?",
  "Vi que suas contas estão rendendo bastante! Divide um trocado com o dev?",
  "Cada apoio vira novos recursos e correções para o painel. Valeu por usar!",
];
const THANKS: Record<Kind, string> = {
  pix: "Pix copiado! Obrigado, você é demais! 💛",
  usdt: "Copiado! Envie só pela rede Solana. Obrigado! 💛",
};

const KEY_SNOOZE = "support.snoozeUntil";
const KEY_NEXT_MSG = "support.nextMsg";
const FIRST_DELAY = 60_000; // 1ª aparição, depois de 1 min usando o painel
const VISIBLE_FOR = 22_000; // tempo na tela (pausa com o dedo/mouse em cima)
const EVERY = 12 * 60_000; // intervalo entre aparições
const SNOOZE_DISMISS = 24 * 3600_000; // "Agora não": some por 1 dia
const SNOOZE_DONE = 7 * 24 * 3600_000; // depois de copiar: some por 7 dias

const store = {
  get: (k: string): number => {
    try {
      return Number(localStorage.getItem(k)) || 0;
    } catch {
      return 0;
    }
  },
  set: (k: string, v: number) => {
    try {
      localStorage.setItem(k, String(v));
    } catch {
      /* navegação privada: segue sem lembrar */
    }
  },
};

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback para contexto sem HTTPS / navegador sem permissão.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Botão de copiar com confirmação "Copiado!". `onCopied` avisa o pai (ex.: agradecer). */
function CopyButton({ kind, label, onCopied }: { kind: Kind; label: string; onCopied?: (k: Kind) => void }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const onClick = async () => {
    const ok = await copy(kind === "pix" ? PIX : USDT);
    setState(ok ? "ok" : "fail");
    if (ok) onCopied?.(kind);
    setTimeout(() => setState("idle"), 1800);
  };
  return (
    <button type="button" onClick={onClick} className="btn w-full" aria-live="polite">
      {state === "ok" ? <Check className="size-4 shrink-0 text-poke-green" aria-hidden /> : <Copy className="size-4 shrink-0" aria-hidden />}
      <span className="truncate">{state === "ok" ? "Copiado!" : state === "fail" ? "Não copiou" : label}</span>
    </button>
  );
}

/** Eevee animado (sprite do Pokémon Showdown, servido localmente). */
function Mascot({ flip = false, height = 110 }: { flip?: boolean; height?: number }) {
  return (
    <motion.img
      src="/support/eevee.gif"
      alt="Eevee animado"
      width={64}
      height={55}
      draggable={false}
      animate={{ y: [0, -3, 0] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      className={`w-auto select-none ${flip ? "-scale-x-100" : ""}`}
      style={{ height, imageRendering: "pixelated" }}
    />
  );
}

/** Texto que "digita" letra a letra, como a caixa de diálogo do jogo. */
function useTypewriter(text: string) {
  const [n, setN] = useState(() => (reducedMotion() ? text.length : 0));
  useEffect(() => {
    if (reducedMotion()) {
      setN(text.length);
      return;
    }
    setN(0);
    const id = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(id), v) : v + 1)), 26);
    return () => clearInterval(id);
  }, [text]);
  return { shown: text.slice(0, n), done: n >= text.length };
}

/** Card lateral (telas largas): um para o Pix, outro para o USDT. A fala troca com o tempo. */
export function SupportSide({ kind }: { kind: Kind }) {
  const [qr, setQr] = useState(false);
  const [i, setI] = useState(kind === "pix" ? 0 : 2);
  const pix = kind === "pix";
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % MESSAGES.length), 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <aside
      aria-label={pix ? "Apoie com Pix" : "Apoie com USDT"}
      className="card fixed top-32 z-10 hidden w-[260px] flex-col items-center gap-2.5 p-4 text-center min-[1860px]:flex"
      style={pix ? { left: "calc(50vw - 640px - 276px)" } : { left: "calc(50vw + 640px + 16px)" }}
    >
      <Mascot flip={!pix} />
      <div className="flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wide text-poke-gold">
        <Coffee className="size-4" aria-hidden /> Me pague um café
      </div>
      <div className="flex min-h-[4.5rem] items-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="text-xs leading-snug text-mute"
          >
            {MESSAGES[i]}
          </motion.p>
        </AnimatePresence>
      </div>
      {pix && qr && <img src="/support/pix-qr.png" alt="QR Code do Pix" className="size-40 rounded-lg bg-white p-1.5" />}
      <CopyButton kind={kind} label={pix ? "Copiar Pix copia e cola" : "Copiar endereço USDT"} />
      {pix && (
        <button type="button" onClick={() => setQr((v) => !v)} className="btn w-full">
          <QrCode className="size-4" aria-hidden /> {qr ? "Ocultar QR Code" : "Mostrar QR Code"}
        </button>
      )}
      {!pix && <p className="text-[11px] leading-snug text-mute">Somente rede Solana. Outras redes podem perder o valor.</p>}
    </aside>
  );
}

const OPEN_EVENT = "support:open";

/** Linha discreta no fim da página (telas sem cards laterais): leva à seção de apoio em Configurações. */
export function SupportStrip() {
  return (
    <button
      type="button"
      onClick={() => {
        location.hash = "config"; // a seção "Apoie o projeto" fica no topo de Configurações
      }}
      className="mx-auto mt-3 flex w-full max-w-7xl items-center justify-center gap-2 rounded-xl border border-line bg-tile/60 px-3 py-2 text-xs font-semibold text-mute transition-colors hover:border-edge/70 hover:text-poke-gold min-[1860px]:hidden sm:mt-4 sm:text-sm"
    >
      <Coffee className="size-4 shrink-0 text-poke-gold" aria-hidden /> Gostando do painel? Apoie o projeto
    </button>
  );
}

/**
 * O Eevee aparece "do nada" com uma caixa de diálogo, pede apoio e some sozinho.
 * Volta de tempos em tempos com falas diferentes; "Agora não" ou copiar a chave o silenciam por dias.
 * Para testar sem esperar: abra o painel com `?apoio` na URL.
 */
export function SupportPopup({ disabled = false }: { disabled?: boolean }) {
  const off = useRef(disabled);
  off.current = disabled;
  const [open, setOpen] = useState(false);
  const [thanked, setThanked] = useState<Kind | null>(null);
  const [msgIdx, setMsgIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const nextTimer = useRef<ReturnType<typeof setTimeout>>();

  const schedule = useCallback((delay: number) => {
    clearTimeout(nextTimer.current);
    nextTimer.current = setTimeout(() => show(false), delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const show = useCallback(
    (force: boolean) => {
      const snooze = store.get(KEY_SNOOZE) - Date.now();
      if (off.current && !force) return schedule(30_000); // fora de hora (ex.: Configurações): tenta de novo depois
      if (!force && snooze > 0) return schedule(snooze + 1000);
      const n = store.get(KEY_NEXT_MSG);
      setMsgIdx(n % MESSAGES.length);
      store.set(KEY_NEXT_MSG, n + 1);
      setThanked(null);
      setOpen(true);
    },
    [schedule],
  );

  const hide = useCallback(
    (snoozeMs = 0) => {
      setOpen(false);
      if (snoozeMs) store.set(KEY_SNOOZE, Date.now() + snoozeMs);
      schedule(Math.max(EVERY, snoozeMs));
    },
    [schedule],
  );

  // Agenda a 1ª aparição; `?apoio` força na hora; o botão do rodapé também.
  useEffect(() => {
    const forced = new URLSearchParams(location.search).has("apoio");
    schedule(forced ? 1500 : FIRST_DELAY);
    if (forced) store.set(KEY_SNOOZE, 0);
    const onOpen = () => show(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      clearTimeout(nextTimer.current);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [schedule, show]);

  // Some sozinho depois de um tempo, exceto enquanto o usuário está com o dedo/mouse em cima.
  useEffect(() => {
    if (!open || paused) return;
    const t = setTimeout(() => hide(), thanked ? 3500 : VISIBLE_FOR);
    return () => clearTimeout(t);
  }, [open, paused, thanked, hide]);

  const thank = (k: Kind) => {
    setThanked(k);
    store.set(KEY_SNOOZE, Date.now() + SNOOZE_DONE);
  };

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const text = thanked ? THANKS[thanked] : MESSAGES[msgIdx];
  const { shown, done } = useTypewriter(text);

  return (
    <AnimatePresence>
      {open && !disabled && (
        <motion.div
          role="complementary"
          aria-label="Apoie o projeto"
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 48 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
          className="fixed inset-x-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex items-end justify-end gap-1 min-[1860px]:hidden sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[400px]"
        >
          {/* Caixa de diálogo estilo jogo */}
          <div className="card relative min-w-0 flex-1 p-3 pr-3.5 sm:p-3.5" style={{ borderRadius: 14 }}>
            <p className="min-h-[3.75rem] text-sm font-medium leading-snug text-fg">
              {shown}
              {!done && <span aria-hidden className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-poke-gold align-middle" />}
            </p>
            <AnimatePresence initial={false}>
              {done && !thanked && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <CopyButton kind="pix" label="Copiar Pix" onCopied={thank} />
                    <CopyButton kind="usdt" label="USDT" onCopied={thank} />
                  </div>
                  <button
                    type="button"
                    onClick={() => hide(SNOOZE_DISMISS)}
                    className="mt-1.5 w-full py-1 text-center text-xs font-semibold text-mute hover:text-fg"
                  >
                    Agora não
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            {/* Setinha apontando para o Eevee */}
            <span
              aria-hidden
              className="absolute -right-[7px] bottom-8 size-3 rotate-45 border-r-2 border-t-2 border-edge"
              style={{ background: "#1d140b" }}
            />
          </div>
          <motion.div
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 14, delay: 0.15 }}
            className="shrink-0 pb-1"
          >
            <Mascot height={84} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Seção "Apoie o projeto" no topo de Configurações: tudo num lugar fixo, sem depender do pop-up. */
export function SupportSection() {
  const [qr, setQr] = useState(false);
  return (
    <section className="space-y-3" aria-label="Apoie o projeto">
      <h2 className="text-lg font-extrabold uppercase tracking-wide">Apoie o projeto</h2>
      <div className="card p-3 sm:p-5">
        <div className="flex items-center gap-3 sm:gap-4">
          <Mascot height={72} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wide text-poke-gold">
              <Coffee className="size-4 shrink-0" aria-hidden /> Me pague um café
            </div>
            <p className="mt-1 text-sm leading-snug text-mute">
              O projeto é gratuito, sem anúncios e de código aberto. Você roda tudo na sua própria máquina, então não há servidor nem mensalidade. Qualquer valor ajuda a manter o desenvolvimento, as correções e as novidades. Não é obrigatório e não libera recurso extra.
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:mt-4 sm:grid-cols-2 sm:gap-3">
          <div className="tile min-w-0 space-y-2 p-3">
            <div className="label">Pix (copia e cola)</div>
            <code className="block truncate rounded-md bg-black/30 px-2 py-1.5 text-xs text-mute">{PIX}</code>
            {qr && <img src="/support/pix-qr.png" alt="QR Code do Pix" className="mx-auto size-44 rounded-lg bg-white p-1.5" />}
            <div className="grid grid-cols-2 gap-2">
              <CopyButton kind="pix" label="Copiar Pix" />
              <button type="button" onClick={() => setQr((v) => !v)} className="btn w-full">
                <QrCode className="size-4 shrink-0" aria-hidden /> {qr ? "Ocultar QR" : "Ver QR Code"}
              </button>
            </div>
          </div>

          <div className="tile min-w-0 space-y-2 p-3">
            <div className="label">USDT (somente rede Solana)</div>
            <code className="block break-all rounded-md bg-black/30 px-2 py-1.5 text-xs text-mute">{USDT}</code>
            <CopyButton kind="usdt" label="Copiar endereço USDT" />
            <p className="text-[11px] leading-snug text-mute">Envie apenas USDT pela rede Solana. Tokens de outras redes enviados para esse endereço podem ser perdidos.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

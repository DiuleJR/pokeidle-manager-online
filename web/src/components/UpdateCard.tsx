import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpCircle, CircleCheck, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ConfirmDialog } from "@/components/ui";
import { admin, AuthError, type UpdateState } from "@/lib/admin";
import { httpBase } from "@/lib/api";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado");

// ------------------------------------------------------------------ estado compartilhado
// Um único estado para o banner e para a seção de Configurações ficarem sempre iguais.
interface Store {
  data: UpdateState | null;
  checking: boolean; // "Verificar atualização" em andamento
  applying: boolean; // atualização em andamento (ou reiniciando)
  message: { tone: "ok" | "error"; text: string } | null;
  finished: string | null; // atualizou, mas falta reiniciar à mão: fica na tela até recarregar
}
let store: Store = { data: null, checking: false, applying: false, message: null, finished: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<Store>) => {
  store = { ...store, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const snapshot = () => store;

async function refresh() {
  try {
    set({ data: await admin.update() });
  } catch {
    /* sem login ou servidor fora: o painel já avisa em outro lugar */
  }
}

async function checkNow() {
  set({ checking: true, message: null });
  try {
    const d = await admin.checkUpdate();
    set({
      data: d,
      message: d.error
        ? { tone: "error", text: d.error }
        : d.available
          ? null
          : { tone: "ok", text: `Você já está na versão mais recente (${d.current}).` },
    });
  } catch (e) {
    if (e instanceof AuthError) location.reload();
    else set({ message: { tone: "error", text: errMsg(e) } });
  } finally {
    set({ checking: false });
  }
}

/** Espera o bot voltar (ele reinicia sozinho) e recarrega o painel com a versão nova. */
function waitForRestart() {
  let down = false;
  let tries = 0;
  const id = setInterval(async () => {
    tries++;
    try {
      const r = await fetch(`${httpBase()}/healthz`, { cache: "no-store" });
      if (r.ok && (down || tries > 6)) {
        clearInterval(id);
        location.reload();
      }
    } catch {
      down = true;
    }
    if (tries > 90) {
      clearInterval(id);
      set({ applying: false, message: { tone: "error", text: "O bot não voltou sozinho. Abra o iniciar.bat / iniciar.sh de novo." } });
    }
  }, 2000);
}

async function applyNow() {
  set({ applying: true, message: null });
  const poll = setInterval(refresh, 1500); // mostra o passo atual ("Baixando…")
  try {
    const r = await admin.applyUpdate();
    clearInterval(poll);
    if (r.restarting) {
      set({ message: { tone: "ok", text: r.message } });
      waitForRestart();
    } else {
      set({ applying: false, finished: r.message, message: { tone: "ok", text: r.message } });
      void refresh();
    }
  } catch (e) {
    clearInterval(poll);
    if (e instanceof AuthError) location.reload();
    else set({ applying: false, message: { tone: "error", text: errMsg(e) } });
    void refresh();
  }
}

export function useUpdate() {
  const s = useSyncExternalStore(subscribe, snapshot);
  return { ...s, checkNow, applyNow };
}

/** Atualiza o estado local (barato, sem rede externa) a cada minuto. Usado uma vez, no banner. */
function useUpdatePolling() {
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh(); // voltou para a aba: mostra o estado atual na hora
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}

const ago = (t: number | null) => {
  if (!t) return "ainda não verificado";
  const m = Math.round((Date.now() / 1000 - t) / 60);
  return m < 1 ? "agora há pouco" : m < 60 ? `há ${m} min` : `há ${Math.round(m / 60)} h`;
};

function Notes({ text }: { text: string }) {
  if (!text) return null;
  return <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-2.5 font-sans text-xs leading-relaxed text-mute">{text}</pre>;
}

/** Confirmação + botão que dispara a atualização. */
function ApplyButton({ d, className = "" }: { d: UpdateState; className?: string }) {
  const { applying, applyNow } = useUpdate();
  const [ask, setAsk] = useState(false);
  if (!d.canApply) return null;
  return (
    <>
      <button className={`btn ${className}`} data-active="true" disabled={applying} onClick={() => setAsk(true)}>
        {applying ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUpCircle className="size-4" aria-hidden />}
        {applying ? d.step || "Atualizando…" : "Atualizar agora"}
      </button>
      <ConfirmDialog
        open={ask}
        danger={false}
        title={`Atualizar para a versão ${d.latest}?`}
        message={
          d.supervised
            ? "O bot baixa a versão nova e reinicia sozinho. As contas desconectam por alguns segundos e voltam sozinhas. Seus dados e contas não são alterados."
            : "O bot baixa a versão nova. Depois você precisa fechar e abrir o bot de novo (iniciar.bat / iniciar.sh) para usá-la. Seus dados e contas não são alterados."
        }
        confirmLabel="Atualizar"
        onCancel={() => setAsk(false)}
        onConfirm={() => {
          setAsk(false);
          void applyNow();
        }}
      />
    </>
  );
}

// ------------------------------------------------------------------ banner (todas as abas)
const dismissedKey = (v: string) => `update.dismissed.${v}`;

export function UpdateBanner() {
  useUpdatePolling();
  const { data: d, applying, message, finished } = useUpdate();
  const [hidden, setHidden] = useState<string | null>(null);
  const [notes, setNotes] = useState(false);
  const wasHidden = useCallback((v: string) => {
    try {
      return sessionStorage.getItem(dismissedKey(v)) === "1";
    } catch {
      return false;
    }
  }, []);

  if (applying && message?.tone === "ok") {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#2f6b3a] bg-[#16301c] px-3 py-2.5 text-sm text-poke-green" role="status">
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> {message.text}
      </div>
    );
  }
  if (finished) {
    return (
      <div className="mb-3 flex items-start gap-2 rounded-xl border border-[#2f6b3a] bg-[#16301c] px-3 py-2.5 text-sm text-poke-green" role="status">
        <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> <span className="min-w-0 flex-1">{finished}</span>
      </div>
    );
  }
  if (!d?.available || !d.latest || hidden === d.latest || wasHidden(d.latest)) return null;
  const v = d.latest;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-3 rounded-xl border border-[#7a5a1c] bg-[#33260e] px-3 py-2.5 sm:mb-4 sm:px-4"
        role="status"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ArrowUpCircle className="size-5 shrink-0 text-poke-gold" aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <b className="text-poke-gold">Versão {v} disponível</b>
            <span className="text-mute"> (você está na {d.current})</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {d.notes && (
              <button className="btn" onClick={() => setNotes((n) => !n)}>
                {notes ? "Ocultar novidades" : "Ver novidades"}
              </button>
            )}
            {d.canApply ? (
              <ApplyButton d={d} />
            ) : (
              <a className="btn" href={d.url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" aria-hidden /> Baixar
              </a>
            )}
            <button
              className="btn"
              onClick={() => {
                setHidden(v);
                try {
                  sessionStorage.setItem(dismissedKey(v), "1");
                } catch {
                  /* sem sessionStorage: some só até recarregar */
                }
              }}
            >
              Depois
            </button>
          </div>
        </div>
        {notes && (
          <div className="mt-2">
            <Notes text={d.notes} />
          </div>
        )}
        {message?.tone === "error" && <div className="mt-2 text-sm text-poke-red">{message.text}</div>}
      </motion.div>
    </AnimatePresence>
  );
}

// ------------------------------------------------------------------ seção de Configurações
export function UpdateSection() {
  const { data: d, checking, applying, message, checkNow } = useUpdate();
  return (
    <section className="space-y-3" aria-label="Atualizações">
      <h2 className="text-lg font-extrabold uppercase tracking-wide">Atualizações</h2>
      <div className="tile space-y-3 p-3 sm:p-4">
        {!d ? (
          <p className="text-sm text-mute">Carregando…</p>
        ) : !d.enabled ? (
          <p className="text-sm text-mute">A verificação de atualizações está desligada neste computador (UPDATE_CHECK=0).</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="text-sm">
                <div>
                  Versão instalada: <b className="tnum">{d.current}</b>
                </div>
                <div className="text-xs text-mute">Última verificação: {ago(d.checkedAt)} (o painel verifica sozinho a cada hora)</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn" disabled={checking || applying} onClick={() => void checkNow()}>
                  {checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
                  {checking ? "Verificando…" : "Verificar atualização"}
                </button>
                {d.available && <ApplyButton d={d} />}
              </div>
            </div>

            {d.available && d.latest && (
              <div className="space-y-2 rounded-lg border border-[#7a5a1c] bg-[#33260e] p-3">
                <div className="flex items-center gap-2 text-sm font-bold text-poke-gold">
                  <ArrowUpCircle className="size-4" aria-hidden /> Versão {d.latest} disponível
                </div>
                <Notes text={d.notes} />
                {!d.canApply && (
                  <p className="text-sm text-mute">
                    {d.cannotApplyReason}{" "}
                    <a className="text-poke-gold underline" href={d.url} target="_blank" rel="noreferrer">
                      Abrir a página da Release
                    </a>
                  </p>
                )}
              </div>
            )}

            {!d.available && !message && !d.error && d.latest && (
              <p className="flex items-center gap-1.5 text-sm text-poke-green">
                <CircleCheck className="size-4" aria-hidden /> Você está na versão mais recente.
              </p>
            )}
            {message && (
              <p className={`text-sm ${message.tone === "ok" ? "text-poke-green" : "text-poke-red"}`} role={message.tone === "error" ? "alert" : "status"}>
                {message.text}
              </p>
            )}
            {!message && d.error && <p className="text-sm text-poke-red">{d.error}</p>}
          </>
        )}
      </div>
    </section>
  );
}

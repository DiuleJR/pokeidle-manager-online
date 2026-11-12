import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Pencil, Plus, Power, RefreshCw, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import { SupportSection } from "@/components/SupportCard";
import { UpdateSection } from "@/components/UpdateCard";
import { ConfirmDialog, Reveal } from "@/components/ui";
import {
  AuthError,
  BOOKMARKLET,
  SNIPPET,
  admin,
  authApi,
  type AdminAccount,
  type GlobalSettings,
  type ImportResult,
  type ProxyInput,
} from "@/lib/admin";
import type { AccountStatus } from "@/lib/types";

const EASE = [0.22, 1, 0.36, 1] as const;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado");

// ------------------------------------------------------------------ utilidades
function statusOf(a: AdminAccount): { status: AccountStatus; text: string } {
  if (!a.enabled) return { status: "offline", text: "Desligada" };
  if (a.blocked) return { status: "blocked", text: a.blocked.detail };
  switch (a.state) {
    case "ONLINE":
      return { status: "online", text: "Online" };
    case "PAUSED_COOLDOWN":
      return { status: "paused_cooldown", text: a.lastReason || "Pausada" };
    case "CONNECTING":
    case "AUTHENTICATING":
    case "STARTING":
      return { status: "offline", text: "Conectando…" };
    default:
      return { status: "offline", text: a.lastReason || "Offline" };
  }
}

/** Mesmo formato aceito pelo servidor: JSON do bookmarklet, do hello, ou com a chave `sessao`. */
function parsePaste(text: string): { nick: string; token: string; device: string } | null {
  const t = text.trim();
  let obj: unknown = null;
  try {
    obj = JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        obj = JSON.parse(t.slice(a, b + 1));
      } catch {
        return null;
      }
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  let sess: Record<string, unknown> = {};
  try {
    const raw = typeof o.sessao === "string" ? JSON.parse(o.sessao) : o.sessao;
    if (raw && typeof raw === "object") sess = raw as Record<string, unknown>;
  } catch {
    /* ignora */
  }
  const src = { ...o, ...sess };
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    nick: str(src.nick),
    token: str(src.token),
    device: str(src.dispositivo) || str(src.device_id) || str(src.deviceId) || str(o["id-dispositivo"]),
  };
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="presentation"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: EASE }}
        onClick={(e) => e.stopPropagation()}
        className={`card my-auto w-full p-4 sm:p-5 ${wide ? "max-w-2xl" : "max-w-lg"}`}
      >
        {/* Cabeçalho fixo no topo: o X continua à mão mesmo rolando uma janela comprida (celular). */}
        <div className="sticky top-0 z-10 -mx-4 -mt-4 flex items-center justify-between gap-3 rounded-t-[14px] border-b border-line bg-[#261a0f] px-4 py-2 sm:-mx-5 sm:-mt-5 sm:px-5">
          <h2 className="min-w-0 truncate text-lg font-extrabold leading-tight sm:text-xl">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" title="Fechar" className="btn !min-h-11 !min-w-11 shrink-0 !px-0">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="mt-3 space-y-3">{children}</div>
      </motion.div>
    </motion.div>
  );
}

export function Notice({ tone, children }: { tone: "warn" | "error" | "ok"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-[#2f6b3a] bg-[#16301c] text-poke-green"
      : tone === "error"
        ? "border-[#7a2f27] bg-[#32140f] text-poke-red"
        : "border-[#7a5a1c] bg-[#33260e] text-poke-gold";
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`} role={tone === "error" ? "alert" : undefined}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label block">{label}</span>
      {children}
      {hint && <span className="block text-xs text-mute">{hint}</span>}
    </label>
  );
}

export function Check2({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-[#f3c04a]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/** Selo pequeno: aceso (verde) = ativo; apagado = inativo. Mesmo visual do selo de status. */
export function Chip({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      title={`${label}: ${on ? "ativo" : "desativado"}`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-bold uppercase tracking-wide transition-colors ${
        on ? "border-[#2f6b3a] bg-[#16301c] text-poke-green" : "border-line bg-tile text-mute opacity-50"
      }`}
    >
      <span className={`size-2 rounded-full ${on ? "bg-poke-green" : "bg-mute"}`} />
      {label}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          window.prompt("Copie (Ctrl+C):", text);
        }
      }}
    >
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {done ? "Copiado!" : label}
    </button>
  );
}

// ------------------------------------------------------------------ proxy
interface ProxyForm {
  scheme: string;
  host: string;
  port: string;
  username: string;
  password: string;
}
const EMPTY_PROXY: ProxyForm = { scheme: "socks5", host: "", port: "", username: "", password: "" };

function proxyInput(f: ProxyForm, keepPassword = false): ProxyInput | null {
  if (!f.host.trim()) return null;
  return {
    scheme: f.scheme,
    host: f.host.trim(),
    port: Number(f.port),
    username: f.username,
    // Em edição, senha vazia = manter a salva (enviamos null).
    password: keepPassword && f.password === "" ? null : f.password,
  };
}

function ProxyFields({ value, onChange, accountId, hasSavedPassword }: { value: ProxyForm; onChange: (v: ProxyForm) => void; accountId?: number; hasSavedPassword?: boolean }) {
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ProxyForm, v: string) => onChange({ ...value, [k]: v });
  const test = async () => {
    const p = proxyInput(value, !!accountId);
    if (!p || !p.port) return setRes({ ok: false, text: "Preencha o host e a porta." });
    setBusy(true);
    setRes(null);
    try {
      const r = await admin.testProxy(p, accountId);
      setRes({ ok: r.ok, text: r.ok ? `Funcionando. IP de saída: ${r.ip}` : r.detail || "Falhou" });
    } catch (e) {
      setRes({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2">
        <Labeled label="Tipo">
          <select className="field w-full" value={value.scheme} onChange={(e) => set("scheme", e.target.value)}>
            {["socks5", "socks5h", "http", "https", "socks4"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Labeled>
        <div className="col-span-2">
          <Labeled label="Host">
            <input className="field w-full" value={value.host} onChange={(e) => set("host", e.target.value)} placeholder="proxy.exemplo.com" autoComplete="off" />
          </Labeled>
        </div>
        <Labeled label="Porta">
          <input className="field w-full" inputMode="numeric" value={value.port} onChange={(e) => set("port", e.target.value.replace(/\D/g, ""))} placeholder="1080" />
        </Labeled>
        <Labeled label="Usuário">
          <input className="field w-full" value={value.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" />
        </Labeled>
        <Labeled label="Senha">
          <input
            className="field w-full"
            type="password"
            value={value.password}
            onChange={(e) => set("password", e.target.value)}
            placeholder={hasSavedPassword ? "(salva)" : ""}
            autoComplete="new-password"
          />
        </Labeled>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" type="button" onClick={test} disabled={busy}>
          {busy ? "Testando…" : "Testar proxy"}
        </button>
        {res && <span className={`text-sm ${res.ok ? "text-poke-green" : "text-poke-red"}`}>{res.text}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ adicionar conta
type Method = "bookmarklet" | "console" | "manual";

/** Passo a passo para copiar nick/token/dispositivo do jogo (bookmarklet ou console). */
function CopyGuide({ method }: { method: "bookmarklet" | "console" }) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    // React bloqueia "javascript:" em href; definimos direto no DOM (o bookmarklet é arrastado dali).
    linkRef.current?.setAttribute("href", BOOKMARKLET);
  }, [method]);

  return method === "bookmarklet" ? (
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      <li>
        Arraste este botão para a barra de favoritos do navegador (no PC):{" "}
        <a ref={linkRef} draggable className="btn inline-flex" onClick={(e) => e.preventDefault()} title="Arraste para a barra de favoritos">
          ⭐ Copiar conta Pokeidle
        </a>{" "}
        ou <CopyButton text={BOOKMARKLET} label="copiar o endereço" /> e crie um favorito colando-o em "URL".
      </li>
      <li>
        Abra <b>pokeidle.io/app</b>, entre na conta e clique no favorito. Os dados da conta vão para a área de transferência.
      </li>
      <li>Volte aqui e cole no campo abaixo.</li>
    </ol>
  ) : (
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      <li>
        <CopyButton text={SNIPPET} label="Copiar o código" />
      </li>
      <li>
        Abra <b>pokeidle.io/app</b> logada, aperte <b>F12</b>, vá na aba <b>Console</b>, cole o código e aperte Enter. (Se o navegador pedir, digite <code>allow pasting</code> antes.)
      </li>
      <li>Volte aqui e cole o resultado no campo abaixo.</li>
    </ol>
  );
}

function AddAccountDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<Method>("bookmarklet");
  const [text, setText] = useState("");
  const [manual, setManual] = useState({ nick: "", token: "", device: "" });
  const [proxy, setProxy] = useState<ProxyForm>(EMPTY_PROXY);
  const [useProxy, setUseProxy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const submit = async (skipTest: boolean) => {
    setBusy(true);
    setError(null);
    setFailed(null);
    try {
      const p = useProxy ? proxyInput(proxy) : null;
      if (useProxy && (!p || !p.port)) throw new Error("Preencha o host e a porta do proxy (ou desmarque a opção).");
      const base = method === "manual" ? { nick: manual.nick, token: manual.token, device_id: manual.device } : { text };
      const r = await admin.importAccount({ ...base, proxy: p, skip_test: skipTest });
      if (!r.ok) {
        setFailed(r.test?.detail || "O teste de conexão falhou.");
        return;
      }
      setResult(r);
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (result?.account) {
    return (
      <Modal title="Conta adicionada" onClose={onClose}>
        <Notice tone="ok">
          <b>{result.account.nick}</b> foi salva e já está conectando
          {result.test?.level ? ` (nível ${result.test.level})` : ""}.
        </Notice>
        {result.generatedDevice && <p className="text-sm text-mute">O ID do dispositivo não veio nos dados, então o painel gerou um próprio para esta conta.</p>}
        {result.warnings?.map((w) => (
          <Notice key={w} tone="warn">
            {w}
          </Notice>
        ))}
        <Notice tone="warn">
          Não clique em <b>Sair</b> no jogo e feche a aba dele: usar a mesma conta no navegador derruba o bot (login externo).
        </Notice>
        <div className="flex justify-end">
          <button className="btn" data-active="true" onClick={onClose}>
            Concluir
          </button>
        </div>
      </Modal>
    );
  }

  const canSubmit = method === "manual" ? !!manual.nick && !!manual.token : !!parsePaste(text)?.token;
  return (
    <Modal title="Adicionar conta" onClose={onClose} wide>
      <Notice tone="warn">
        Feche o jogo no navegador antes de ligar a conta aqui. Duas conexões da mesma conta se derrubam (login externo).
      </Notice>

      <div className="flex gap-1.5" role="tablist">
        {(
          [
            ["bookmarklet", "Bookmarklet (1 clique)"],
            ["console", "Console (F12)"],
            ["manual", "Manual"],
          ] as [Method, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={method === id} className="btn" data-active={method === id} onClick={() => setMethod(id)}>
            {label}
          </button>
        ))}
      </div>

      {method !== "manual" && <CopyGuide method={method} />}

      {method === "manual" ? (
        <div className="space-y-2.5">
          <Labeled label="Nick">
            <input className="field w-full" value={manual.nick} onChange={(e) => setManual({ ...manual, nick: e.target.value })} autoComplete="off" />
          </Labeled>
          <Labeled label="Token">
            <input className="field w-full" type="password" value={manual.token} onChange={(e) => setManual({ ...manual, token: e.target.value })} autoComplete="off" />
          </Labeled>
          <Labeled label="ID do dispositivo (opcional)" hint="Se vazio, o painel gera um para esta conta.">
            <input className="field w-full" value={manual.device} onChange={(e) => setManual({ ...manual, device: e.target.value })} autoComplete="off" />
          </Labeled>
        </div>
      ) : (
        <Labeled label="Cole aqui o que foi copiado">
          <textarea
            className="field h-24 w-full resize-y py-2 font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"nick":"...","token":"...","dispositivo":"..."}'
            spellCheck={false}
          />
        </Labeled>
      )}
      {method !== "manual" && text.trim() && !parsePaste(text) && <Notice tone="error">Não reconheci esse formato. Cole o JSON copiado pelo favorito ou pelo console.</Notice>}

      <div className="space-y-2.5 rounded-lg border border-line p-3">
        <Check2 checked={useProxy} onChange={setUseProxy}>
          Usar proxy nesta conta
        </Check2>
        {!useProxy && <p className="text-xs text-mute">Sem proxy, a conta conecta pelo IP desta máquina.</p>}
        {useProxy && <ProxyFields value={proxy} onChange={setProxy} />}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {failed && (
        <Notice tone="error">
          {failed}
          <div className="mt-2">
            <button className="btn" onClick={() => submit(true)} disabled={busy}>
              Salvar mesmo assim
            </button>
          </div>
        </Notice>
      )}

      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn border-0 bg-poke-gold font-bold text-void hover:bg-[#f6ca5e]" onClick={() => submit(false)} disabled={busy || !canSubmit}>
          {busy ? "Testando conexão…" : "Testar e salvar"}
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ editar conta
function EditAccountDialog({ acc, onClose, onDone }: { acc: AdminAccount; onClose: () => void; onDone: () => void }) {
  const o = acc.options;
  const [proxy, setProxy] = useState<ProxyForm>(
    acc.proxy ? { scheme: acc.proxy.scheme, host: acc.proxy.host, port: String(acc.proxy.port), username: acc.proxy.username, password: "" } : EMPTY_PROXY,
  );
  const [opts, setOpts] = useState({
    auto_catch: o.auto_catch,
    auto_potion: o.auto_potion,
    potion_restock_threshold: String(o.potion_restock_threshold),
    potion_restock_qty: String(o.potion_restock_qty),
    auto_ball_restock: o.auto_ball_restock,
    ball_restock_threshold: String(o.ball_restock_threshold),
    ball_restock_qty: String(o.ball_restock_qty),
  });
  const [paste, setPaste] = useState("");
  const [guide, setGuide] = useState<"bookmarklet" | "console">("bookmarklet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        proxy: proxyInput(proxy, true),
        options: {
          auto_catch: opts.auto_catch,
          auto_potion: opts.auto_potion,
          potion_restock_threshold: Number(opts.potion_restock_threshold),
          potion_restock_qty: Number(opts.potion_restock_qty),
          auto_ball_restock: opts.auto_ball_restock,
          ball_restock_threshold: Number(opts.ball_restock_threshold),
          ball_restock_qty: Number(opts.ball_restock_qty),
        },
      };
      if (proxy.host.trim() && !Number(proxy.port)) throw new Error("Informe a porta do proxy.");
      if (paste.trim()) {
        const p = parsePaste(paste);
        if (!p?.token) throw new Error("Não reconheci os dados colados para atualizar o token.");
        body.token = p.token;
        if (p.device) body.device_id = p.device;
      }
      await admin.patch(acc.numericId, body);
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const num = (k: keyof typeof opts) => (
    <input className="field w-full" inputMode="numeric" value={opts[k] as string} onChange={(e) => setOpts({ ...opts, [k]: e.target.value.replace(/\D/g, "") })} />
  );

  return (
    <Modal title={`Editar ${acc.nick}`} onClose={onClose} wide>
      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-mute">Proxy</h3>
        <ProxyFields value={proxy} onChange={setProxy} accountId={acc.numericId} hasSavedPassword={acc.proxy?.hasPassword} />
        <p className="mt-1.5 text-xs text-mute">Deixe o host vazio para conectar sem proxy.</p>
      </div>
      <div className="space-y-2.5">
        <h3 className="text-sm font-bold uppercase tracking-wide text-mute">Automação</h3>
        <Check2 checked={opts.auto_catch} onChange={(v) => setOpts({ ...opts, auto_catch: v })}>
          Captura automática de Pokémon
        </Check2>
        <Check2 checked={opts.auto_potion} onChange={(v) => setOpts({ ...opts, auto_potion: v })}>
          Repor Potions automaticamente
        </Check2>
        {opts.auto_potion && (
          <div className="grid grid-cols-2 gap-2">
            <Labeled label="Repor abaixo de">{num("potion_restock_threshold")}</Labeled>
            <Labeled label="Quantidade a comprar">{num("potion_restock_qty")}</Labeled>
          </div>
        )}
        <Check2 checked={opts.auto_ball_restock} onChange={(v) => setOpts({ ...opts, auto_ball_restock: v })}>
          Repor Balls automaticamente
        </Check2>
        {opts.auto_ball_restock && (
          <div className="grid grid-cols-2 gap-2">
            <Labeled label="Repor abaixo de">{num("ball_restock_threshold")}</Labeled>
            <Labeled label="Quantidade a comprar">{num("ball_restock_qty")}</Labeled>
          </div>
        )}
      </div>
      <details className="rounded-lg border border-line px-3 py-2.5" open={!!acc.blocked || acc.tokenStatus === "invalid"}>
        <summary className="cursor-pointer text-sm font-bold uppercase tracking-wide text-mute">Reimportar token</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-mute">Use quando o jogo deixar de aceitar o token da conta (venceu ou foi encerrado).</p>
          <div className="flex gap-1.5" role="tablist">
            {(
              [
                ["bookmarklet", "Bookmarklet (1 clique)"],
                ["console", "Console (F12)"],
              ] as ["bookmarklet" | "console", string][]
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={guide === id} className="btn" data-active={guide === id} onClick={() => setGuide(id)}>
                {label}
              </button>
            ))}
          </div>
          <CopyGuide method={guide} />
        <textarea className="field h-16 w-full resize-y py-2 font-mono text-xs" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Cole aqui os dados copiados do jogo" spellCheck={false} />
        <p className="text-xs text-mute">Token atual: {acc.tokenHint}</p>
        </div>
      </details>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn border-0 bg-poke-gold font-bold text-void hover:bg-[#f6ca5e]" onClick={save} disabled={busy}>
          {busy ? "Salvando…" : "Salvar e reiniciar a conta"}
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ linha de conta
function AccountRow({ acc, onChanged }: { acc: AdminAccount; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { status, text } = statusOf(acc);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const needsReimport = acc.blocked?.kind === "invalid" || acc.tokenStatus === "invalid";

  return (
    <div className="tile p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <StatusPill status={status} />
            <span className="truncate text-base font-extrabold sm:text-lg">{acc.nick}</span>
            <Chip on={!!acc.proxy} label="Proxy" />
          </div>
          {status !== "online" && <p className="mt-1 break-words text-sm text-mute">{text}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button className="btn" disabled={busy} onClick={() => run(() => admin.patch(acc.numericId, { enabled: !acc.enabled }))} title={acc.enabled ? "Desligar" : "Ligar"} aria-label={acc.enabled ? "Desligar" : "Ligar"}>
            <Power className="size-4" aria-hidden />
            <span className="hidden sm:inline">{acc.enabled ? "Desligar" : "Ligar"}</span>
          </button>
          <button className="btn" disabled={busy || !acc.enabled} onClick={() => run(() => admin.restart(acc.numericId))} title="Reiniciar a conexão" aria-label="Reiniciar">
            <RefreshCw className="size-4" aria-hidden />
            <span className="hidden sm:inline">Reiniciar</span>
          </button>
          <button className="btn" disabled={busy} onClick={() => setEditing(true)} title="Editar" aria-label="Editar">
            <Pencil className="size-4" aria-hidden />
            <span className="hidden sm:inline">Editar</span>
          </button>
          <button className="btn" disabled={busy} onClick={() => setConfirmDelete(true)} aria-label={`Remover ${acc.nick}`}>
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {needsReimport && (
        <div className="mt-2.5">
          <Notice tone="error">
            O jogo não aceitou o token desta conta (venceu ou foi encerrado). Clique em <b>Editar</b> e reimporte os dados.
          </Notice>
        </div>
      )}
      {acc.state === "PAUSED_COOLDOWN" && /4001|login externo/.test(acc.lastReason) && (
        <div className="mt-2.5">
          <Notice tone="warn">Outro login tomou esta conta (provavelmente o jogo aberto no navegador). Feche-o: o bot tenta de novo sozinho a cada 5 minutos.</Notice>
        </div>
      )}
      {msg && (
        <div className="mt-2.5">
          <Notice tone="error">{msg}</Notice>
        </div>
      )}
      <AnimatePresence>{editing && <EditAccountDialog acc={acc} onClose={() => setEditing(false)} onDone={onChanged} />}</AnimatePresence>
      <ConfirmDialog
        open={confirmDelete}
        title={`Remover ${acc.nick}?`}
        message="A conta deixa de ser gerenciada aqui e o token salvo é apagado. Para voltar, será preciso importá-la de novo. Nada muda no jogo."
        confirmLabel="Remover"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          run(async () => {
            await admin.remove(acc.numericId);
            setConfirmDelete(false);
          })
        }
      />
    </div>
  );
}

// ------------------------------------------------------------------ configurações globais
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Bloco com título e, à direita, um selo de estado opcional. */
function Group({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-mute">{title}</h3>
        {badge}
      </div>
      {children}
    </div>
  );
}

function GlobalForm() {
  const [s, setS] = useState<GlobalSettings | null>(null);
  const [form, setForm] = useState({ ws_url: "", report_hour: 0, report_tz: "", public_url: "" });
  const [hook, setHook] = useState<string | null>(null); // null = não está editando o webhook
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const fill = (g: GlobalSettings) => {
    setS(g);
    setForm({ ws_url: g.ws_url, report_hour: g.report_hour, report_tz: g.report_tz, public_url: g.public_url });
  };
  useEffect(() => {
    admin.settings().then(fill).catch((e) => setMsg({ ok: false, text: errMsg(e) }));
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  const run = async (fn: () => Promise<void>, okText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <p className="text-mute">Carregando…</p>;

  const dirty =
    form.ws_url !== s.ws_url || form.report_hour !== s.report_hour || form.report_tz !== s.report_tz || form.public_url !== s.public_url;

  return (
    <div className="space-y-5">
      <Group title="Discord" badge={<Chip on={s.hasWebhook} label={s.hasWebhook ? "Ativo" : "Desligado"} />}>
        {hook === null ? (
          <div className="flex flex-wrap gap-1.5">
            <button className="btn" onClick={() => setHook("")}>
              {s.hasWebhook ? "Trocar webhook" : "Configurar webhook"}
            </button>
            {s.hasWebhook && (
              <>
                <button className="btn" disabled={busy} onClick={() => run(() => admin.testWebhook().then(() => undefined), "Mensagem de teste enviada ao Discord.")}>
                  Enviar teste
                </button>
                <button className="btn" onClick={() => setConfirmRemove(true)}>
                  Remover
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <input
              className="field w-full"
              type="password"
              value={hook}
              onChange={(e) => setHook(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              autoComplete="off"
              autoFocus
            />
            <div className="flex gap-1.5">
              <button
                className="btn border-0 bg-poke-gold font-bold text-void hover:bg-[#f6ca5e]"
                disabled={busy || !hook.trim()}
                onClick={() =>
                  run(async () => {
                    fill(await admin.saveSettings({ discord_webhook: hook.trim() }));
                    setHook(null);
                  }, "Webhook salvo.")
                }
              >
                Salvar
              </button>
              <button className="btn" onClick={() => setHook(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
        <p className="text-xs text-mute">Avisa quando uma conta cai ou volta, quando cai item raro e envia o relatório do dia.</p>
      </Group>

      <Group title="Avisos do Mercado" badge={<Chip on={s.hasWebhook && (s.alert_sell || s.alert_sold)} label={s.hasWebhook ? (s.alert_sell || s.alert_sold ? "Ativo" : "Desligado") : "Precisa do webhook"} />}>
        <div className="space-y-3">
          <Check2 checked={s.alert_sold} onChange={(v) => run(async () => fill(await admin.saveSettings({ alert_sold: v })), v ? "Aviso de venda ligado." : "Aviso de venda desligado.")}>
            Avisar quando um anúncio das minhas contas for vendido
          </Check2>
          <Check2 checked={s.alert_sell} onChange={(v) => run(async () => fill(await admin.saveSettings({ alert_sell: v })), v ? "Aviso de preço alto ligado." : "Aviso de preço alto desligado.")}>
            Avisar quando um item raro que eu tenho estiver caro em Gemas
          </Check2>
          {s.alert_sell && (
            <label className="flex items-center justify-between gap-3 pl-6 text-sm">
              Caro = pelo menos
              <select
                className="field"
                value={s.alert_sell_pct}
                disabled={busy}
                onChange={(e) => run(async () => fill(await admin.saveSettings({ alert_sell_pct: Number(e.target.value) })), "Limite salvo.")}
              >
                {[15, 20, 30, 50, 75, 100].map((p) => (
                  <option key={p} value={p}>
                    {p}% acima da média
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-xs text-mute">O preço alto é comparado com a média de 7 dias do Mercado. Cada item só é avisado de novo depois de 6 horas, ou se o preço subir ainda mais.</p>
        </div>
      </Group>

      <Group title="Relatório diário">
        <label className="flex items-center justify-between gap-3 text-sm">
          O dia vira às
          <select className="field" value={form.report_hour} onChange={(e) => setForm({ ...form, report_hour: Number(e.target.value) })}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
      </Group>

      <details className="group rounded-lg border border-line px-3 py-2.5">
        <summary className="cursor-pointer text-sm font-semibold text-mute">Avançado</summary>
        <div className="mt-3 space-y-3">
          <Labeled label="Fuso horário">
            <input className="field w-full" value={form.report_tz} onChange={(e) => setForm({ ...form, report_tz: e.target.value })} placeholder="America/Sao_Paulo" />
          </Labeled>
          <Labeled label="URL pública do painel" hint="Opcional. Só para mostrar o ícone do item raro no Discord.">
            <input className="field w-full" value={form.public_url} onChange={(e) => setForm({ ...form, public_url: e.target.value })} placeholder="https://meu-dominio.exemplo" />
          </Labeled>
          <Labeled label="Servidor do jogo (WebSocket)" hint={`Padrão: ${s.defaultWsUrl}. Mudar reinicia as contas.`}>
            <input className="field w-full" value={form.ws_url} onChange={(e) => setForm({ ...form, ws_url: e.target.value })} />
          </Labeled>
        </div>
      </details>

      {msg && <Notice tone={msg.ok ? "ok" : "error"}>{msg.text}</Notice>}

      {dirty && (
        <div className="flex justify-end gap-1.5">
          <button className="btn" disabled={busy} onClick={() => fill(s)}>
            Descartar
          </button>
          <button
            className="btn border-0 bg-poke-gold font-bold text-void hover:bg-[#f6ca5e]"
            disabled={busy}
            onClick={() => run(async () => fill(await admin.saveSettings(form)), "Configurações salvas.")}
          >
            {busy ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title="Remover o webhook?"
        message="O bot deixa de enviar avisos ao Discord. Para voltar, será preciso colar a URL do webhook de novo."
        confirmLabel="Remover"
        busy={busy}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() =>
          run(async () => {
            fill(await admin.saveSettings({ discord_webhook: "" }));
            setConfirmRemove(false);
          }, "Webhook removido.")
        }
      />
    </div>
  );
}

// ------------------------------------------------------------------ segurança
function SecurityGroup() {
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authApi.status().then((s) => setPasswordSet(s.passwordSet)).catch(() => setPasswordSet(null));
  }, []);

  const save = async () => {
    if (f.next.length < 8) return setMsg({ ok: false, text: "A nova senha precisa ter pelo menos 8 caracteres." });
    if (f.next !== f.again) return setMsg({ ok: false, text: "As senhas não são iguais." });
    setBusy(true);
    setMsg(null);
    try {
      await authApi.changePassword(passwordSet ? f.current : null, f.next);
      setPasswordSet(true);
      setOpen(false);
      setF({ current: "", next: "", again: "" });
      setMsg({ ok: true, text: "Senha salva. Os outros aparelhos precisarão entrar de novo." });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {!open && (
        <div className="flex flex-wrap gap-1.5">
          <button className="btn" onClick={() => { setOpen(true); setMsg(null); }}>
            {passwordSet === false ? "Definir senha" : "Alterar senha"}
          </button>
          <button
            className="btn"
            onClick={async () => {
              await authApi.logout().catch(() => undefined);
              location.reload();
            }}
          >
            Sair
          </button>
        </div>
      )}
      {open && (
        <div className="space-y-2.5">
          {passwordSet && (
            <Labeled label="Senha atual">
              <input className="field w-full" type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" />
            </Labeled>
          )}
          <Labeled label="Nova senha" hint="Mínimo de 8 caracteres.">
            <input className="field w-full" type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" />
          </Labeled>
          <Labeled label="Repita a nova senha">
            <input className="field w-full" type="password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} autoComplete="new-password" />
          </Labeled>
          <div className="flex gap-1.5">
            <button className="btn border-0 bg-poke-gold font-bold text-void hover:bg-[#f6ca5e]" disabled={busy} onClick={save}>
              {busy ? "Salvando…" : "Salvar senha"}
            </button>
            <button className="btn" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {msg && <Notice tone={msg.ok ? "ok" : "error"}>{msg.text}</Notice>}
    </div>
  );
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function SettingsView() {
  const [data, setData] = useState<{ max: number; accounts: AdminAccount[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await admin.accounts());
      setError(null);
    } catch (e) {
      if (e instanceof AuthError) location.reload(); // sessão expirou: volta para a tela de login
      else setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const i = setInterval(() => void load(), 4000);
    return () => clearInterval(i);
  }, [load]);

  const insecure = location.protocol === "http:" && !LOCAL_HOSTS.includes(location.hostname);
  const full = !!data && data.accounts.length >= data.max;

  return (
    <div className="space-y-5 sm:space-y-6">
      {insecure && (
        <Notice tone="warn">
          Você está acessando o painel por <b>HTTP</b> fora do seu computador: a chave e os tokens trafegam sem criptografia. Prefira um túnel SSH (<code>ssh -L 8080:localhost:8080 usuario@servidor</code>) ou HTTPS.
        </Notice>
      )}

      <Reveal index={0}>
        <SupportSection />
      </Reveal>

      <Reveal as="section" index={1} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold uppercase tracking-wide">Contas {data && <span className="tnum text-mute">({data.accounts.length}/{data.max})</span>}</h2>
          <button className="btn" data-active="true" onClick={() => setAdding(true)} disabled={full}>
            <Plus className="size-4" aria-hidden />
            Adicionar conta
          </button>
        </div>
        {full && <p className="text-sm text-mute">Limite de {data?.max} contas (regra do jogo: 4 por pessoa). Remova uma para adicionar outra.</p>}
        {error && <Notice tone="error">{error}</Notice>}
        {data && data.accounts.length === 0 && (
          <div className="card p-8 text-center text-mute">Nenhuma conta ainda. Clique em <b>Adicionar conta</b> para começar.</div>
        )}
        <div className="space-y-2.5">
          {data?.accounts.map((a, n) => (
            <Reveal key={a.id} index={n + 2} step={0.06}>
              <AccountRow acc={a} onChanged={load} />
            </Reveal>
          ))}
        </div>
      </Reveal>

      <Reveal as="section" index={4} className="space-y-3">
        <h2 className="text-lg font-extrabold uppercase tracking-wide">Geral</h2>
        <div className="tile p-3 sm:p-4">
          <GlobalForm />
        </div>
      </Reveal>

      <Reveal index={5}>
        <UpdateSection />
      </Reveal>

      <Reveal as="section" index={6} className="space-y-3">
        <h2 className="text-lg font-extrabold uppercase tracking-wide">Segurança</h2>
        <div className="tile p-3 sm:p-4">
          <SecurityGroup />
        </div>
      </Reveal>

      <AnimatePresence>{adding && <AddAccountDialog onClose={() => setAdding(false)} onDone={load} />}</AnimatePresence>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { authApi, type AuthStatus } from "@/lib/admin";
import { startTelemetry } from "@/lib/telemetry";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado");

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="card w-full max-w-sm space-y-4 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <img src="/icon-192.png" alt="" aria-hidden className="size-10 shrink-0 rounded-lg" />
          <h1 className="text-lg font-extrabold uppercase leading-tight tracking-wide sm:text-xl">Pokeidle Manager</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function Setup({ status, onDone }: { status: AuthStatus; onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < status.minPassword) return setError(`A senha precisa ter pelo menos ${status.minPassword} caracteres.`);
    if (pw !== pw2) return setError("As senhas não são iguais.");
    setBusy(true);
    setError(null);
    try {
      await authApi.setup(pw, status.needsCode ? code : undefined);
      onDone();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Shell>
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-sm text-mute">Olá! Crie uma senha para proteger o painel. Você vai usá-la sempre que abrir o painel em um navegador novo.</p>
        <label className="block space-y-1.5">
          <span className="label block">Nova senha</span>
          <input className="field w-full" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus />
        </label>
        <label className="block space-y-1.5">
          <span className="label block">Repita a senha</span>
          <input className="field w-full" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        </label>
        {status.needsCode && (
          <label className="block space-y-1.5">
            <span className="label block">Código de configuração</span>
            <input className="field w-full" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
            <span className="block text-xs text-mute">Você está acessando de fora do computador do bot. O código aparece no console (ou em <code>journalctl -u pokeidle</code>).</span>
          </label>
        )}
        {error && (
          <p className="text-sm text-poke-red" role="alert">
            {error}
          </p>
        )}
        <button className="btn w-full" data-active="true" type="submit" disabled={busy || !pw || !pw2 || (status.needsCode && !code)}>
          {busy ? "Criando…" : "Criar senha e entrar"}
        </button>
        <p className="text-xs text-mute">Mínimo de {status.minPassword} caracteres. Esqueceu depois? Rode <code>python main.py --reset-password</code> no computador do bot.</p>
      </form>
    </Shell>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.login(pw);
      onDone();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Shell>
      <form className="space-y-3" onSubmit={submit}>
        <label className="block space-y-1.5">
          <span className="label block">Senha</span>
          <input className="field w-full" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus />
        </label>
        {error && (
          <p className="text-sm text-poke-red" role="alert">
            {error}
          </p>
        )}
        <button className="btn w-full" data-active="true" type="submit" disabled={busy || !pw}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </Shell>
  );
}

/** Só mostra o painel depois do login (ou da criação da senha, no 1º acesso). */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [st, setSt] = useState<AuthStatus | "loading" | "error">("loading");
  const mock = !!import.meta.env.VITE_MOCK;

  const load = useCallback(() => {
    authApi
      .status()
      .then(setSt)
      .catch(() => setSt("error"));
  }, []);
  useEffect(() => {
    if (!mock) load();
  }, [load, mock]);

  const ok = mock || (typeof st === "object" && st.mode === "login" && st.authenticated);
  useEffect(() => {
    if (ok) startTelemetry(); // só conecta o WebSocket depois de autenticada
  }, [ok]);

  if (ok) return <>{children}</>;
  if (st === "loading") return <Shell><p className="text-sm text-mute">Carregando…</p></Shell>;
  if (st === "error")
    return (
      <Shell>
        <p className="text-sm text-poke-red">Não consegui falar com o bot. Ele está rodando?</p>
        <button className="btn" onClick={() => { setSt("loading"); load(); }}>
          Tentar de novo
        </button>
      </Shell>
    );
  return st.mode === "setup" ? <Setup status={st} onDone={load} /> : <Login onDone={load} />;
}

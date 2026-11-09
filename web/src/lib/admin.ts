import { httpBase, panelKey } from "./api";

/** Erro de autenticação: a chave do painel falta ou está errada. */
export class AuthError extends Error {}

export interface ProxyView {
  scheme: string;
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
}
export interface AccountOptions {
  hunt_slug: string;
  auto_catch: boolean;
  ball_priority: number[];
  auto_potion: boolean;
  potion_id: number | null;
  potion_restock_threshold: number;
  potion_restock_qty: number;
  auto_ball_restock: boolean;
  ball_id: number | null;
  ball_restock_threshold: number;
  ball_restock_qty: number;
}
export interface AdminAccount {
  id: string;
  numericId: number;
  nick: string;
  tokenHint: string;
  deviceHint: string;
  enabled: boolean;
  proxy: ProxyView | null;
  options: AccountOptions;
  tokenStatus: string;
  tokenDetail: string;
  state: string;
  lastReason: string;
  blocked: { kind: string; detail: string } | null;
}
export interface ProxyInput {
  scheme: string;
  host: string;
  port: number;
  username: string;
  password?: string | null;
}
export interface TestResult {
  ok: boolean;
  kind: string;
  detail: string;
  nick?: string;
  level?: number;
  live?: boolean;
}
export interface ImportResult {
  ok: boolean;
  stage?: string;
  test?: TestResult | null;
  account?: AdminAccount;
  generatedDevice?: boolean;
  warnings?: string[];
}
export interface GlobalSettings {
  ws_url: string;
  report_hour: number;
  report_tz: string;
  public_url: string;
  hasWebhook: boolean;
  webhookHint: string;
  defaultWsUrl: string;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = panelKey();
  const r = await fetch(`${httpBase()}${path}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => null);
  if (r.status === 401) throw new AuthError("Chave do painel inválida");
  if (!r.ok) throw new Error(j?.error || (Array.isArray(j?.detail) ? "Dados inválidos" : `HTTP ${r.status}`));
  return j as T;
}

export interface AuthStatus {
  mode: "setup" | "login";
  authenticated: boolean;
  needsCode: boolean;
  passwordSet: boolean;
  minPassword: number;
}

/** Chamadas de autenticação: erros (401/403/429) viram mensagens legíveis, não AuthError. */
async function authCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${httpBase()}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || (Array.isArray(j?.detail) ? "Dados inválidos" : `HTTP ${r.status}`));
  return j as T;
}

export const authApi = {
  status: () => authCall<AuthStatus>("GET", "/api/auth/status"),
  setup: (password: string, code?: string) => authCall<{ ok: boolean }>("POST", "/api/auth/setup", { password, code: code ?? null }),
  login: (password: string) => authCall<{ ok: boolean }>("POST", "/api/auth/login", { password }),
  logout: () => authCall<{ ok: boolean }>("POST", "/api/auth/logout"),
  changePassword: (current: string | null, next: string) =>
    authCall<{ ok: boolean }>("POST", "/api/auth/password", { current, new: next }),
};

export const admin = {
  accounts: () => call<{ max: number; accounts: AdminAccount[] }>("GET", "/api/accounts"),
  importAccount: (b: {
    text?: string;
    nick?: string;
    token?: string;
    device_id?: string;
    proxy?: ProxyInput | null;
    skip_test?: boolean;
  }) => call<ImportResult>("POST", "/api/accounts/import", b),
  patch: (id: number, b: Record<string, unknown>) => call<{ ok: boolean; account: AdminAccount }>("PATCH", `/api/accounts/${id}`, b),
  remove: (id: number) => call<{ ok: boolean }>("DELETE", `/api/accounts/${id}`),
  restart: (id: number) => call<{ ok: boolean }>("POST", `/api/accounts/${id}/restart`),
  test: (id: number) => call<TestResult>("POST", `/api/accounts/${id}/test`),
  testProxy: (proxy: ProxyInput, accountId?: number) =>
    call<{ ok: boolean; ip?: string; detail?: string }>("POST", "/api/proxy/test", { proxy, account_id: accountId ?? null }),
  settings: () => call<GlobalSettings>("GET", "/api/settings"),
  saveSettings: (b: Record<string, unknown>) => call<GlobalSettings>("PUT", "/api/settings", b),
  testWebhook: () => call<{ ok: boolean }>("POST", "/api/settings/test-webhook"),
};

/**
 * Código que lê a sessão do jogo (localStorage do pokeidle.io) e copia
 * {nick, token, dispositivo} para a área de transferência. Roda só na máquina da
 * pessoa, na aba do jogo; nada é enviado a lugar nenhum.
 */
export const SNIPPET =
  "(()=>{try{const s=JSON.parse(localStorage.getItem('sessao')||'null');" +
  "if(!s||!s.token){alert('Entre na sua conta no jogo primeiro.');return}" +
  "const o=JSON.stringify({nick:s.nick,token:s.token,dispositivo:localStorage.getItem('id-dispositivo')||''});" +
  "const ok=()=>alert('Conta '+s.nick+' copiada! Volte ao painel e cole.');" +
  "navigator.clipboard.writeText(o).then(ok,()=>{prompt('Copie (Ctrl+C) e cole no painel:',o)})" +
  "}catch(e){alert('Não consegui ler a sessão: '+e.message)}})()";

export const BOOKMARKLET = "javascript:" + encodeURIComponent(SNIPPET);

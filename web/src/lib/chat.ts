import { useEffect, useSyncExternalStore } from "react";
import { apiUrl, httpBase, panelKey } from "./api";
import { call } from "./admin";

/**
 * Chat do jogo, fora do React (useSyncExternalStore), como a telemetria:
 * uma conexão /ws/chat por aba do navegador, mensagens por canal, não lidas e avisos.
 */

export const CHANNELS = [
  { id: "mundo", label: "Mundo" },
  { id: "comercio", label: "Comércio" },
  { id: "duvidas", label: "Dúvidas" },
] as const;
export type ChannelId = (typeof CHANNELS)[number]["id"];

export interface ChatMsg {
  id: number | string;
  ts: number;
  canal: ChannelId;
  de: string;
  nivel: number | null;
  /** Cargo no jogo (vip, helper, admin, anuncio, compartilhar, shiny...): define a cor do nick e do texto. */
  cargo: string | null;
  guild: string | null;
  /** Cor da tag da guild (hex validado no servidor). */
  guildColor: string | null;
  kind: "msg" | "shiny" | "rare" | "share" | "ad";
  text: string;
  /** Só nos anúncios do mercado: a oferta separada, para destacar nome e preço. */
  ad: { qtd: number; nome: string; preco: string; moeda: "gold" | "gemas" } | null;
}
export interface ChatNotice {
  key: number;
  account: string;
  code: string;
  text: string;
}
export type ChatLink = "connecting" | "open" | "closed";

interface ChatState {
  messages: Record<ChannelId, ChatMsg[]>;
  /** Não lidas por canal; `mention` = alguém chamou uma das suas contas. */
  unread: Record<ChannelId, { n: number; mention: boolean }>;
  link: ChatLink;
  notice: ChatNotice | null;
  /** Nicks das suas contas (para destacar menções). */
  mine: string[];
}

const MAX = 200;
const empty = (): Record<ChannelId, ChatMsg[]> => ({ mundo: [], comercio: [], duvidas: [] });
const noUnread = () => ({ n: 0, mention: false });

let state: ChatState = {
  messages: empty(),
  unread: { mundo: noUnread(), comercio: noUnread(), duvidas: noUnread() },
  link: "connecting",
  notice: null,
  mine: [],
};
const listeners = new Set<() => void>();
const emit = (next: Partial<ChatState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

/** O chat que o usuário está olhando agora: mensagens dele não contam como não lidas. */
let watching: ChannelId | null = null;

export const mentions = (text: string, nicks: string[]) => {
  const t = text.toLowerCase();
  return nicks.some((n) => n && t.includes(`@${n.toLowerCase()}`));
};

function pushUnread(m: ChatMsg) {
  if (watching === m.canal) return;
  const u = state.unread[m.canal];
  emit({ unread: { ...state.unread, [m.canal]: { n: u.n + 1, mention: u.mention || mentions(m.text, state.mine) } } });
}

export function setWatching(canal: ChannelId | null) {
  watching = canal;
  if (canal && (state.unread[canal].n || state.unread[canal].mention)) {
    emit({ unread: { ...state.unread, [canal]: noUnread() } });
  }
}

export function setMyNicks(nicks: string[]) {
  if (nicks.join("|") !== state.mine.join("|")) emit({ mine: nicks });
}

export function dismissNotice() {
  if (state.notice) emit({ notice: null });
}

let noticeKey = 0;
function handle(ev: { type: string; [k: string]: unknown }) {
  if (ev.type === "init") {
    const all = ev.messages as Record<ChannelId, ChatMsg[]>;
    emit({ messages: { mundo: all.mundo ?? [], comercio: all.comercio ?? [], duvidas: all.duvidas ?? [] } });
  } else if (ev.type === "chat") {
    const m = ev.msg as ChatMsg;
    const list = state.messages[m.canal];
    if (!list || list.some((x) => x.id === m.id)) return;
    emit({ messages: { ...state.messages, [m.canal]: [...list, m].slice(-MAX) } });
    pushUnread(m);
  } else if (ev.type === "history") {
    emit({ messages: { ...state.messages, [ev.canal as ChannelId]: ev.msgs as ChatMsg[] } });
  } else if (ev.type === "del") {
    const c = ev.canal as ChannelId;
    emit({ messages: { ...state.messages, [c]: state.messages[c].filter((x) => x.id !== ev.id) } });
  } else if (ev.type === "notice") {
    emit({ notice: { key: ++noticeKey, account: String(ev.account), code: String(ev.code), text: String(ev.text) } });
  }
}

let started = false;
let retry = 0;
function chatWsUrl() {
  const u = new URL(httpBase().replace(/^http/, "ws") + "/ws/chat");
  const key = panelKey();
  if (key) u.searchParams.set("token", key);
  return u.toString();
}

function connect() {
  emit({ link: "connecting" });
  let ws: WebSocket;
  try {
    ws = new WebSocket(chatWsUrl());
  } catch {
    emit({ link: "closed" });
    return;
  }
  ws.onopen = () => {
    retry = 0;
    emit({ link: "open" });
  };
  ws.onmessage = (e) => {
    try {
      handle(JSON.parse(e.data));
    } catch {
      /* frame estranho: ignora */
    }
  };
  ws.onclose = () => {
    emit({ link: "closed" });
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry));
  };
}

/** Liga o chat uma única vez (idempotente); o painel chama ao montar. */
export function startChat() {
  if (started) return;
  started = true;
  if (import.meta.env.VITE_MOCK) {
    emit({ link: "open" });
    void import("./mock").then((m) => m.startMockChat(handle));
    return;
  }
  connect();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useChat(): ChatState {
  useEffect(() => startChat(), []);
  return useSyncExternalStore(subscribe, () => state);
}

export const totalUnread = (s: ChatState) => {
  const all = Object.values(s.unread);
  return { n: all.reduce((a, u) => a + u.n, 0), mention: all.some((u) => u.mention) };
};

// ------------------------------------------------------------ envio

export class ChatSendError extends Error {
  constructor(
    message: string,
    public code: string,
    public wait: number,
  ) {
    super(message);
  }
}

/** `account` = id da conta ("acc3"). Levanta ChatSendError com o motivo em português. */
export async function sendChat(account: string, canal: ChannelId, texto: string): Promise<void> {
  try {
    await call("POST", "/api/chat/send", { account: Number(account.replace(/\D/g, "")), canal, texto });
  } catch (e) {
    const err = e as Error & { code?: string; wait?: number; body?: { code?: string; wait?: number } };
    throw new ChatSendError(err.message || "Não foi possível enviar.", err.code ?? err.body?.code ?? "", err.wait ?? err.body?.wait ?? 0);
  }
}

// ------------------------------------------------------------ Discord

export interface Community {
  url: string;
  name: string | null;
  online: number | null;
  members: number | null;
}
const FALLBACK: Community = { url: "https://discord.gg/pFVashEjtH", name: null, online: null, members: null };
let community: Community = FALLBACK;
const cListeners = new Set<() => void>();
let cStarted = false;

/** Uma única cadeia que se reagenda sozinha: 5 min quando deu certo; logo de novo quando não leu o Discord. */
async function loadCommunity() {
  let next = 20_000;
  try {
    const r = await fetch(apiUrl("/api/community"));
    if (r.ok) {
      community = (await r.json()) as Community;
      cListeners.forEach((l) => l());
      next = community.online == null ? 60_000 : 5 * 60_000;
    }
  } catch {
    /* sem números: o link continua valendo */
  }
  setTimeout(() => void loadCommunity(), next);
}

export function useCommunity(): Community {
  useEffect(() => {
    if (cStarted) return;
    cStarted = true;
    void loadCommunity();
  }, []);
  return useSyncExternalStore(
    (l) => (cListeners.add(l), () => cListeners.delete(l)),
    () => community,
  );
}

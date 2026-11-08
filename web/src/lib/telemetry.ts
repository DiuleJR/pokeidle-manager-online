import { useSyncExternalStore } from "react";
import { wsUrl } from "./api";
import type { AccountSnapshot, ConnectionState, SnapshotMessage } from "./types";

/**
 * Store de telemetria fora do React (useSyncExternalStore).
 * - Cada conta mantem a MESMA referencia se nada mudou -> React.memo evita re-render.
 * - `lastMessageAt` fica em store separado para o indicador de saude nao
 *   re-renderizar os cards a cada snapshot.
 */

export interface HistoryPoint {
  t: number;
  [accountId: string]: number;
}

const HISTORY_MAX = 120;

interface DataState {
  order: string[];
  accounts: Record<string, AccountSnapshot>;
  history: HistoryPoint[];
}
interface LinkState {
  state: ConnectionState;
  lastMessageAt: number | null;
  attempts: number;
}

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const data = createStore<DataState>({ order: [], accounts: {}, history: [] });
const link = createStore<LinkState>({ state: "connecting", lastMessageAt: null, attempts: 0 });

const sameAccount = (a: AccountSnapshot, b: AccountSnapshot) =>
  a.nick === b.nick &&
  a.level === b.level &&
  a.status === b.status &&
  a.xpPerHour === b.xpPerHour &&
  a.goldPerHour === b.goldPerHour &&
  a.gold === b.gold &&
  a.gems === b.gems &&
  a.potions === b.potions &&
  a.balls === b.balls &&
  a.vip === b.vip &&
  a.session?.startedAt === b.session?.startedAt &&
  JSON.stringify(a.session?.items) === JSON.stringify(b.session?.items) &&
  a.pokemon?.looktype === b.pokemon?.looktype &&
  a.pokemon?.level === b.pokemon?.level &&
  a.huntName === b.huntName &&
  a.hunt?.kills === b.hunt?.kills &&
  a.hunt?.minutes === b.hunt?.minutes &&
  a.diamonds === b.diamonds &&
  a.captured?.session === b.captured?.session &&
  a.captured?.failed === b.captured?.failed &&
  a.captured?.total === b.captured?.total &&
  a.captured?.shiny === b.captured?.shiny &&
  JSON.stringify(a.inventory) === JSON.stringify(b.inventory) &&
  a.pokemon?.name === b.pokemon?.name &&
  a.pokemon?.hp === b.pokemon?.hp &&
  a.pokemon?.maxHp === b.pokemon?.maxHp;

export function applySnapshot(msg: SnapshotMessage) {
  const prev = data.get();
  let changed = false;
  const accounts: Record<string, AccountSnapshot> = {};
  for (const acc of msg.accounts) {
    const old = prev.accounts[acc.id];
    if (old && sameAccount(old, acc)) accounts[acc.id] = old;
    else {
      accounts[acc.id] = acc;
      changed = true;
    }
  }
  const order = msg.accounts.map((a) => a.id);
  const orderChanged = order.length !== prev.order.length || order.some((id, i) => id !== prev.order[i]);

  // Historico para os graficos: um ponto por snapshot.
  const point: HistoryPoint = { t: msg.ts };
  for (const acc of msg.accounts) {
    point[`${acc.id}:gold`] = acc.goldPerHour;
    point[`${acc.id}:xp`] = acc.xpPerHour;
  }
  const history = [...prev.history, point].slice(-HISTORY_MAX);

  data.set({
    order: orderChanged ? order : prev.order,
    accounts: changed || orderChanged ? accounts : prev.accounts,
    history,
  });
  clockOffset = msg.ts - Date.now();
  link.set({ ...link.get(), lastMessageAt: Date.now() });
}

/** Diferença (servidor - navegador) medida no último snapshot, p/ cronômetros sem depender do relógio local. */
let clockOffset = 0;
export const serverNow = () => Date.now() + clockOffset;

// --------------------------------------------------------------- conexao

let started = false;

export function startTelemetry() {
  if (started) return;
  started = true;
  if (import.meta.env.VITE_MOCK) {
    void import("./mock").then((m) => m.startMock(applySnapshot, (s) => link.set({ ...link.get(), state: s })));
    return;
  }
  connect();
}

function connect() {
  const url = wsUrl();
  const attempts = link.get().attempts;
  link.set({ ...link.get(), state: attempts === 0 ? "connecting" : "reconnecting" });

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleRetry();
    return;
  }
  ws.onopen = () => link.set({ ...link.get(), state: "open", attempts: 0 });
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string);
      if (msg?.type === "snapshot" && Array.isArray(msg.accounts)) applySnapshot(msg as SnapshotMessage);
    } catch {
      /* mensagem invalida: ignora */
    }
  };
  ws.onclose = scheduleRetry;
  ws.onerror = () => ws.close();
}

function scheduleRetry() {
  const attempts = link.get().attempts + 1;
  link.set({ ...link.get(), state: "reconnecting", attempts });
  // backoff exponencial: 1s, 2s, 4s ... max 15s
  setTimeout(connect, Math.min(15000, 1000 * 2 ** (attempts - 1)));
}

// ----------------------------------------------------------------- hooks

export const useAccountIds = () =>
  useSyncExternalStore(data.subscribe, () => data.get().order);

export const useAccountsMap = () =>
  useSyncExternalStore(data.subscribe, () => data.get().accounts);

export function useAccount(id: string): AccountSnapshot | undefined {
  return useSyncExternalStore(data.subscribe, () => data.get().accounts[id]);
}

export const useHistory = () =>
  useSyncExternalStore(data.subscribe, () => data.get().history);

export const useLink = () => useSyncExternalStore(link.subscribe, link.get);

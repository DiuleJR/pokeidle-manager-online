import { useCallback, useMemo, useState } from "react";

const KEY = "pokeidle-card-order";

/** Quando o último arrasto terminou: evita que o "clique" que o navegador gera ao soltar abra algo. */
export const dragState = { endedAt: 0 };
export const justDragged = () => performance.now() - dragState.endedAt < 250;

const read = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** Ordem dos cards do dashboard, escolhida pelo usuário e lembrada neste navegador. */
export function useCardOrder(ids: string[]) {
  const [saved, setSaved] = useState<string[]>(read);
  const order = useMemo(() => [...saved.filter((i) => ids.includes(i)), ...ids.filter((i) => !saved.includes(i))], [saved, ids]);

  /** Troca dois cards de lugar: o que estava na posição de destino assume a posição do outro. */
  const swap = useCallback(
    (a: string, b: string) => {
      const next = [...order];
      const i = next.indexOf(a);
      const j = next.indexOf(b);
      if (i < 0 || j < 0 || i === j) return;
      [next[i], next[j]] = [next[j], next[i]];
      setSaved(next);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* sem armazenamento: vale só até recarregar */
      }
    },
    [order],
  );
  return { order, swap };
}

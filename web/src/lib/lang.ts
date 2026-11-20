import { useCallback, useSyncExternalStore } from "react";
import { type Lang, itemLabel } from "./itemNames";

export type { Lang };

/** Os três idiomas do jogo, com a bandeira (SVG simples, sem imagem externa). */
export const LANGS: { id: Lang; nome: string; htmlLang: string }[] = [
  { id: "pt", nome: "Português", htmlLang: "pt-BR" },
  { id: "en", nome: "English", htmlLang: "en" },
  { id: "es", nome: "Español", htmlLang: "es" },
];

const KEY = "pim.lang";
const valid = (v: unknown): v is Lang => LANGS.some((l) => l.id === v);

let current: Lang = "pt";
try {
  const saved = localStorage.getItem(KEY);
  if (valid(saved)) current = saved;
} catch {
  /* sem armazenamento: fica em português */
}

const subs = new Set<() => void>();

/** Troca o idioma dos nomes na hora (sem recarregar) e lembra a escolha neste navegador. */
export function setLang(v: Lang) {
  if (v === current || !valid(v)) return;
  current = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignora */
  }
  subs.forEach((f) => f());
}

export const useLang = (): Lang =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
  );

/**
 * Função que devolve o nome do item no idioma escolhido. Quem a usa re-renderiza sozinho quando o idioma
 * muda; a função muda de identidade junto, então serve como dependência de useMemo.
 */
export function useItemLabel() {
  const lang = useLang();
  return useCallback((name: string | null | undefined, id?: number | null) => itemLabel(name, lang, id), [lang]);
}

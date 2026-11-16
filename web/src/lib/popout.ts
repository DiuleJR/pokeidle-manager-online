import { useSyncExternalStore } from "react";

/**
 * Chat destacado numa janela própria, para acompanhar com o painel em segundo plano.
 * Preferência: Picture-in-Picture de documento (Chrome, Edge e Brave): janela flutuante SEMPRE POR CIMA dos outros
 * programas, então dá para ver o chat assistindo um vídeo. Sem essa API, abre uma janela comum.
 * O chat dentro da janela continua sendo o mesmo da página (mesmo estado e mesma conexão): só muda onde é desenhado.
 */

interface DocPip {
  requestWindow(opts?: { width?: number; height?: number }): Promise<Window>;
}
const docPip = (): DocPip | undefined => (window as unknown as { documentPictureInPicture?: DocPip }).documentPictureInPicture;

export const popoutKind = (): "floating" | "window" => (docPip() ? "floating" : "window");

let win: Window | null = null;
const listeners = new Set<() => void>();
const emit = (w: Window | null) => {
  win = w;
  listeners.forEach((l) => l());
};

/** Copia o CSS da página para a janela nova (ela nasce vazia). */
function copyStyles(target: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.document.createElement("style");
      style.textContent = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
      target.document.head.appendChild(style);
    } catch {
      // folha de outra origem (ex.: fontes): reaproveita pelo link
      if (sheet.href) {
        const link = target.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.document.head.appendChild(link);
      }
    }
  }
  // As fontes (Google Fonts) entram por <link>, não por regras acessíveis.
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"], link[rel="preconnect"]').forEach((l) => {
    if (!target.document.head.querySelector(`link[href="${l.href}"]`)) target.document.head.appendChild(l.cloneNode(true));
  });
}

export async function openChatWindow(): Promise<void> {
  if (win && !win.closed) {
    win.focus?.();
    return;
  }
  let w: Window | null = null;
  const pip = docPip();
  if (pip) {
    try {
      w = await pip.requestWindow({ width: 380, height: 640 });
    } catch {
      w = null; // recusou (sem gesto do usuário, por exemplo): cai na janela comum
    }
  }
  if (!w) w = window.open("", "pokeidle-chat", "popup=yes,width=380,height=640");
  if (!w) return; // bloqueador de pop-up
  w.document.title = "Chat · PokeIdle Manager";
  w.document.documentElement.lang = "pt-BR";
  w.document.body.style.margin = "0";
  copyStyles(w);
  w.addEventListener("pagehide", () => emit(null), { once: true });
  emit(w);
}

export function closeChatWindow() {
  const w = win;
  emit(null);
  try {
    w?.close();
  } catch {
    /* já fechada */
  }
}

// Se a página principal fechar ou recarregar, a janela destacada vai junto.
window.addEventListener("pagehide", () => {
  try {
    win?.close();
  } catch {
    /* sem janela */
  }
});

export function useChatWindow(): Window | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => win,
  );
}

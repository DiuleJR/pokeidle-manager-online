import { useEffect } from "react";

/**
 * Trava a rolagem da página enquanto uma janela está aberta (várias podem abrir uma sobre a outra: só destrava a última).
 * Guarda a posição e compensa a barra de rolagem para o fundo não "pular".
 */
let locks = 0;
let saved: { html: string; body: string; padding: string } | null = null;

function lock() {
  if (locks++ > 0) return;
  const html = document.documentElement;
  const body = document.body;
  saved = { html: html.style.overflow, body: body.style.overflow, padding: body.style.paddingRight };
  const bar = window.innerWidth - html.clientWidth;
  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  if (bar > 0) body.style.paddingRight = `${bar}px`;
}

function unlock() {
  if (--locks > 0 || !saved) return;
  locks = 0;
  document.documentElement.style.overflow = saved.html;
  document.body.style.overflow = saved.body;
  document.body.style.paddingRight = saved.padding;
  saved = null;
}

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    lock();
    return unlock;
  }, [active]);
}

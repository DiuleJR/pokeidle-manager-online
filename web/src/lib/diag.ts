/**
 * Diagnóstico: se algo quebrar na página (erro de script ou promessa rejeitada), mostra uma faixa vermelha no rodapé
 * com a mensagem, em vez de deixar a tela vazia sem explicação. Toque na faixa para fechar.
 */
let shown = false;

function banner(text: string) {
  if (shown) return;
  shown = true;
  const el = document.createElement("div");
  el.setAttribute("role", "alert");
  el.style.cssText =
    "position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;padding:10px 12px;border-radius:10px;background:#3a1212;color:#ffd9d2;border:1px solid #ef6b5b;font:12px/1.4 system-ui,sans-serif;cursor:pointer;white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow:auto";
  el.textContent = `Erro na página (toque para fechar):\n${text}`;
  el.onclick = () => {
    el.remove();
    shown = false;
  };
  document.body.appendChild(el);
}

export function installDiagnostics() {
  window.addEventListener("error", (e) => {
    if (e.message?.includes("ResizeObserver")) return;
    banner(`${e.message}${e.filename ? `\n${e.filename.split("/").pop()}:${e.lineno}` : ""}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    const msg = r instanceof Error ? `${r.message}\n${(r.stack ?? "").split("\n").slice(1, 4).join("\n")}` : String(r);
    if (/ServiceWorker|Failed to fetch|NetworkError|Load failed/i.test(msg)) return;
    banner(msg);
  });
}

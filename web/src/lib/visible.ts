/**
 * Intervalo que só roda com a aba visível. Com a tela apagada ou o app em segundo plano o navegador (e o
 * celular) não precisam redesenhar relógios nem refazer consultas: poupa bateria e dados. Ao voltar, `fn`
 * roda na hora para mostrar o estado atual. Devolve a função que cancela.
 */
export function everyWhileVisible(fn: () => void, ms: number): () => void {
  const id = setInterval(() => {
    if (!document.hidden) fn();
  }, ms);
  const onShow = () => {
    if (!document.hidden) fn();
  };
  document.addEventListener("visibilitychange", onShow);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onShow);
  };
}

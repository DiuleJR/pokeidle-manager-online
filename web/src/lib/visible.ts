/**
 * Modo economia (Configurações > Bateria e dados). O servidor avisa em cada mensagem de telemetria se está ligado.
 * Desligado (padrão), nada muda: os relógios e consultas rodam como sempre, até com a aba oculta.
 */
let economy = false;
export const economyMode = () => economy;
export const setEconomyMode = (on: boolean) => {
  economy = on;
};

/**
 * Intervalo que, no modo economia, só roda com a aba visível: com a tela apagada ou o app em segundo plano o
 * navegador não precisa redesenhar relógios nem refazer consultas, e isso poupa bateria e dados. Ao voltar, `fn`
 * roda na hora. Com `always: true` pula a aba oculta mesmo fora do modo economia (consultas que já eram assim).
 * Devolve a função que cancela.
 */
export function everyWhileVisible(fn: () => void, ms: number, opts: { always?: boolean } = {}): () => void {
  const skip = () => document.hidden && (opts.always || economy);
  const id = setInterval(() => {
    if (!skip()) fn();
  }, ms);
  const onShow = () => {
    if (!document.hidden && (opts.always || economy)) fn();
  };
  document.addEventListener("visibilitychange", onShow);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onShow);
  };
}

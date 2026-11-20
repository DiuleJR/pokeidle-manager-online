/**
 * Nomes de TM como o jogo mostra (mesma regra do cliente do jogo e de item_labels.py):
 * "TM Disk Piece" vira "Fragmento de Z-Move" e "Fire-Type TM Disk" vira "Z-Move FIRE".
 * O servidor ainda manda os nomes antigos nas vendas, então a troca é só na hora de mostrar.
 */
const PECA = /(AoE )?\bTM Disk Piece\b/g;
const DISCO = /\b([A-Za-z]+)-Type TM Disk\b( Piece)?/g;

export function zmoveName(text: string): string;
export function zmoveName(text: string | null | undefined): string | undefined;
export function zmoveName(text: string | null | undefined): string | undefined {
  if (!text || !text.includes("TM Disk")) return text ?? undefined;
  return text
    .replace(PECA, (m, aoe) => (aoe ? m : "Fragmento de Z-Move"))
    .replace(DISCO, (m, tipo: string, peca) => (peca ? m : `Z-Move ${tipo.toUpperCase()}`));
}

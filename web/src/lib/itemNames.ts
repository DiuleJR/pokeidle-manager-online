/**
 * Idioma dos nomes de itens, como no jogo. O jogo tem três idiomas (pt, en, es) e, ao trocar, muda na hora os
 * nomes dos itens do servidor (casas, bicicletas, fragmentos, ovos, Z-Move, pedras Shiny...). Os nomes abaixo
 * vêm do dicionário do próprio jogo (pokeidle.io, i18n.mjs, chaves item.* e caixas.nome.*).
 * Os itens do catálogo comum (pedras, poções, bolas...) têm nome único em inglês e não mudam.
 */
export type Lang = "pt" | "en" | "es";

type Row = Record<Lang, string>;

const NAMES: Record<string, Row> = {
  "casa.comum": { pt: "Casa Comum", en: "Common House", es: "Casa Común" },
  "casa.incomum": { pt: "Casa Incomum", en: "Uncommon House", es: "Casa Poco común" },
  "casa.rara": { pt: "Casa Rara", en: "Rare House", es: "Casa Rara" },
  "casa.mitica": { pt: "Casa Mítica", en: "Mythic House", es: "Casa Mítica" },
  "casa.lendaria": { pt: "Casa Lendária", en: "Legendary House", es: "Casa Legendaria" },
  "fragmentoChave": { pt: "Fragmento de Chave", en: "Key Fragment", es: "Fragmento de llave" },
  "fragmentoShiny": { pt: "Fragmento de Shiny Stone", en: "Shiny Stone Fragment", es: "Fragmento de Shiny Stone" },
  "fragmentoBicicleta": { pt: "Fragmento de Bicicleta", en: "Bicycle Fragment", es: "Fragmento de bicicleta" },
  "fragmentoMega": { pt: "Fragmento de MEGA Stone", en: "Mega Stone Fragment", es: "Fragmento de MEGA Stone" },
  "fragmentoMegaShiny": { pt: "Fragmento de MEGA Shiny Stone", en: "Mega Shiny Stone Fragment", es: "Fragmento de MEGA Shiny Stone" },
  "bicicleta.comum": { pt: "Bicicleta Comum", en: "Common Bicycle", es: "Bicicleta Común" },
  "bicicleta.incomum": { pt: "Bicicleta Incomum", en: "Uncommon Bicycle", es: "Bicicleta Poco común" },
  "bicicleta.rara": { pt: "Bicicleta Rara", en: "Rare Bicycle", es: "Bicicleta Rara" },
  "bicicleta.mitica": { pt: "Bicicleta Mítica", en: "Mythic Bicycle", es: "Bicicleta Mítica" },
  "bicicleta.lendaria": { pt: "Bicicleta Lendária", en: "Legendary Bicycle", es: "Bicicleta Legendaria" },
  "xpShareHeld": { pt: "Exp. Share", en: "Exp. Share", es: "Exp. Share" },
  "escapeRope": { pt: "Escape Rope", en: "Escape Rope", es: "Escape Rope" },
  "nameTag": { pt: "Name Tag", en: "Name Tag", es: "Name Tag" },
  "mysticTicket": { pt: "Mystic Ticket", en: "Mystic Ticket", es: "Mystic Ticket" },
  "safariTicket": { pt: "Safari Ticket", en: "Safari Ticket", es: "Safari Ticket" },
  "ovo.p2": { pt: "Mystery Egg P2", en: "Mystery Egg P2", es: "Mystery Egg P2" },
  "ovo.p3": { pt: "Mystery Egg P3", en: "Mystery Egg P3", es: "Mystery Egg P3" },
  "ovo.p4": { pt: "Mystery Egg P4", en: "Mystery Egg P4", es: "Mystery Egg P4" },
  "ovo.shiny": { pt: "Ovo Shiny", en: "Shiny Egg", es: "Huevo Shiny" },
  "fragmentoOvoShiny": { pt: "Fragmento de Ovo Shiny", en: "Shiny Egg Fragment", es: "Fragmento de Huevo Shiny" },
  "ossoSacrificio": { pt: "Osso do Sacrifício", en: "Sacrifice Bone", es: "Hueso del Sacrificio" },
  "fragmentoZMove": { pt: "Fragmento de Z-Move", en: "Z-Move Fragment", es: "Fragmento de Z-Move" },
  "caixa.fundador": { pt: "Caixa de Fundador", en: "Founder Box", es: "Caja de Fundador" },
  "caixa.cofundador": { pt: "Caixa de CoFundador", en: "Co-Founder Box", es: "Caja de CoFundador" },
};

/** Itens por id (os ids do servidor; o resto é achado pelo nome). */
const BY_ID: Record<number, string> = {
  70011: "fragmentoChave", 70012: "fragmentoShiny", 70013: "fragmentoBicicleta", 70014: "fragmentoMega", 70015: "fragmentoMegaShiny",
  70016: "nameTag", 70050: "xpShareHeld", 70010: "escapeRope",
  70040: "casa.comum", 70041: "casa.incomum", 70042: "casa.rara", 70043: "casa.mitica", 70044: "casa.lendaria",
  70080: "bicicleta.comum", 70081: "bicicleta.incomum", 70082: "bicicleta.rara", 70083: "bicicleta.mitica", 70084: "bicicleta.lendaria",
  70060: "caixa.fundador", 70061: "caixa.cofundador",
  59194: "fragmentoZMove",
};

/** Nome (em qualquer idioma, ou o original do servidor) -> chave. */
const BY_NAME = new Map<string, string>();
for (const [key, row] of Object.entries(NAMES)) for (const v of Object.values(row)) BY_NAME.set(v.toLowerCase(), key);
BY_NAME.set("tm disk piece", "fragmentoZMove"); // o servidor ainda manda o nome antigo nas vendas

const TIPOS = "normal|fire|water|grass|electric|ice|fighting|poison|ground|flying|psychic|bug|rock|ghost|dragon|dark|steel|fairy";
const STONE_A = new RegExp(`^shiny stone (${TIPOS})$`, "i"); // "Shiny Stone Fire"
const STONE_B = new RegExp(`^(${TIPOS}) shiny stone$`, "i"); // "Fire Shiny Stone"
const QTD = /^(\s*[\d.,]+\s*[×x]\s*)(.+?)(\s*#\d+\s*)?$/; // "6× Earth Stone", "Common Bicycle #001050"
const SUF = /^(.+?)(\s*#\d+\s*)$/;

function nomeSolto(name: string, lang: Lang, id?: number | null): string {
  const key = (id != null ? BY_ID[id] : undefined) ?? BY_NAME.get(name.trim().toLowerCase());
  if (key) return NAMES[key][lang];
  const z = /^([A-Za-z]+)-Type TM Disk$/.exec(name);
  if (z) return `Z-Move ${z[1].toUpperCase()}`; // igual nos três idiomas
  const s = STONE_A.exec(name) ?? STONE_B.exec(name);
  if (s) return lang === "en" ? `${s[1]} Shiny Stone` : `Shiny Stone ${s[1]}`;
  return name;
}

/** O nome de um item no idioma escolhido. Aceita também uma descrição ("6× Common Bicycle #001050"). */
export function itemLabel(name: string | null | undefined, lang: Lang, id?: number | null): string {
  if (!name) return "";
  const q = QTD.exec(name);
  if (q) return `${q[1]}${nomeSolto(q[2], lang)}${q[3] ?? ""}`;
  const suf = SUF.exec(name);
  if (suf) return `${nomeSolto(suf[1], lang)}${suf[2]}`;
  return nomeSolto(name, lang, id);
}

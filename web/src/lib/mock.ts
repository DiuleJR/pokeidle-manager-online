import type { AccountSnapshot, ConnectionState, SnapshotMessage } from "./types";

/** Gerador de dados falsos (VITE_MOCK=1) para desenvolver a UI sem backend. */
export function startMock(emit: (m: SnapshotMessage) => void, setState: (s: ConnectionState) => void) {
  const D = Math.floor((Date.now() - 10_800_000) / 86_400_000); // dia do passe de hoje (vira à meia-noite de Brasília)
  const names = ["Pikachu", "Charizard", "Gengar", "Snorlax"];
  const statuses: AccountSnapshot["status"][] = ["online", "online", "paused_cooldown", "offline"];
  const accs: AccountSnapshot[] = names.map((p, i) => ({
    id: `acc${i + 1}`,
    nick: `Treinador${i + 1}`,
    level: [2104, 1306, 450, 40][i],
    status: statuses[i],
    pokemon: { name: p, hp: 100, maxHp: 100, level: [565, 487, 333, 21][i] },
    pass: [{ ultimo: D - 1, degrau: 6, total: 5, vipAte: 0, ciclos: 0, vipPegos: 0 }, { ultimo: D, degrau: 12, total: 40, vipAte: Date.now() + 9 * 86_400_000, ciclos: 1, vipPegos: 0b11111111111, ultimoVip: D }, { ultimo: D - 3, degrau: 3, total: 3, vipAte: 0, ciclos: 0, vipPegos: 0 }, null][i],
    map: [{ region: "outland", label: "Outland 2", outland: { tier: 2, label: "Outland 2", mult: 1.25 } }, { region: "hoenn", label: "Hoenn", outland: null }, { region: "kanto", label: "Kanto", outland: null }, { region: "outland", label: "Outland 1", outland: { tier: 1, label: "Outland 1", mult: 1 } }][i],
    xpPerHour: 90_000 + i * 12_000,
    goldPerHour: 15_000 + i * 3_000,
    gold: 1_200_000 * (i + 1),
    gems: 340 + i * 25,
    potions: 120 - i * 10,
    balls: 500 - i * 40,
    equipped: {
      potion: { id: 70070, name: ["Golden Potion", "Super Potion", "Hyper Potion", "Potion"][i], qty: 120 - i * 10, icon: "/assets/site/assets/items/potion.png" },
      ball: { id: 4, name: ["Ultra Ball", "Great Ball", "Poké Ball", "Master Ball"][i], qty: 500 - i * 40, icon: "/assets/site/assets/ui/ball-poke.png" },
    },
    session: { startedAt: Date.now() - (3600 + i * 1700) * 1000, items: { boss: i, key: 2 + i, shinyStone: i % 2, bike: 1 } },
  }));

  const S = "/assets/site/assets";

  // Opções do seletor de poção/bola dos cards + hunt atual de cada conta.
  const POTIONS = [[200, "Small Potion"], [201, "Great Potion"], [202, "Ultra Potion"], [203, "Hyper Potion"], [204, "Ultimate Potion"], [70070, "Golden Potion"]] as const;
  const BALLS = [[1, "Poké Ball"], [2, "Great Ball"], [3, "Super Ball"], [4, "Ultra Ball"], [5, "Beast Ball"]] as const;
  const stock = (i: number, id: number) => (id % 3 === 0 ? 0 : 40 + ((id * 7 + i * 13) % 900));
  accs.forEach((a, i) => {
    const mins = 90 + i * 20;
    a.hunt = { slug: ["bellsprout", "caterpie", "geodude", "magikarp"][i], kills: Math.round((mins / 60) * (780 + i * 65)), minutes: mins };
    a.huntName = ["Bellsprout", "Caterpie", "Geodude", "Magikarp"][i];
    a.equipped!.options = {
      potion: POTIONS.map(([id, name]) => ({ id, name, qty: stock(i, id), icon: `${S}/items/potion.png` })),
      ball: BALLS.map(([id, name]) => ({ id, name, qty: stock(i, id), icon: `${S}/ui/ball-poke.png` })),
    };
  });
  installMockApi(accs);
  // Trava de combate simulada na conta 1: reinicia a cada ~12 s, dura alguns segundos.
  const lockUntil: Record<string, number> = {};
  setInterval(() => {
    lockUntil.acc1 = Date.now() + 4000 + Math.random() * 4000;
  }, 12000);
  lockUntil.acc1 = Date.now() + 6000;
  (window as unknown as { __mockLock: typeof lockUntil }).__mockLock = lockUntil;

  const shared = [
    { id: 70070, name: "Golden Potion", category: "heal", icon: `${S}/items/potion.png` },
    { id: 200, name: "Small Potion", category: "heal", icon: `${S}/markitems/small_potion.png` },
    { id: 70000, name: "Bronze Boss Token", category: "special", rare: true, icon: `${S}/items/bronze_boss_token.png` },
    { id: 70012, name: "Fragmento de Shiny Stone", category: "special", rare: true, icon: "/img/itens/shiny-stone.png" },
  ];
  accs.forEach((a, i) => {
    a.inventory = {
      pokedexSpecies: 200,
      balls: [{ id: 4, name: "Ultra Ball", qty: 500 - i * 40, icon: `${S}/ui/ball-ultra.png` }],
      items: [
        ...shared.filter((_, n) => (n + i) % 3 !== 0).map((it, n) => ({ ...it, qty: 12_000 * (i + 1) + n * 311 })),
        ...(i === 1 ? [{ id: 9001, name: "Item Exclusivo", category: "loot", icon: null, qty: 42 }] : []),
      ],
    };
  });

  setState("open");
  const tick = () => {
    for (const a of accs) {
      if (a.status === "offline") continue;
      const max = a.pokemon!.maxHp;
      a.pokemon!.hp = Math.max(5, Math.min(max, a.pokemon!.hp + Math.round((Math.random() - 0.55) * 20)));
      if (a.status === "online") {
        a.xpPerHour = Math.round(a.xpPerHour * (0.97 + Math.random() * 0.06));
        a.goldPerHour = Math.round(a.goldPerHour * (0.97 + Math.random() * 0.06));
        a.gold += Math.round(a.goldPerHour / 3600);
        if (Math.random() < 0.3) a.balls = Math.max(0, a.balls - 1);
        if (a.hunt) {
          a.hunt = { ...a.hunt, minutes: a.hunt.minutes + 1 / 60, kills: a.hunt.kills + (Math.random() < 0.22 ? 1 : 0) };
        }
      }
    }
    const lock = (window as unknown as { __mockLock?: Record<string, number> }).__mockLock ?? {};
    emit({ type: "snapshot", ts: Date.now(), accounts: accs.map((a) => ({ ...a, pokemon: a.pokemon && { ...a.pokemon }, combatLockMs: Math.max(0, (lock[a.id] ?? 0) - Date.now()) })) });
  };
  tick();
  setInterval(tick, 1000);
}

// ------------------------------------------------------------ chat de mentira (modo de demonstração)
type ChatEvent = { type: string; [k: string]: unknown };
let chatEmit: ((ev: ChatEvent) => void) | null = null;
let chatSeq = 1000;
let lastSendAt = 0;
const pvpAuto = [false, true, false, false];
const mockMsg = (canal: string, de: string, nivel: number | null, text: string, kind = "msg", agoMin = 0, extra: Record<string, unknown> = {}) => ({
  id: ++chatSeq, ts: Date.now() - agoMin * 60_000, canal, de, nivel, cargo: null, guild: null, guildColor: null, ad: null, kind, text, ...extra,
});

// Calculadora da ficha (o exemplo do jogo: Shiny Turtwig Nv 20, nota 6,338; na evolução final, 6,747).
const mockCalc = {
  lendario: false, ivTotal: 153, mercadoMin: 3.5, nota: 6.338, faixa: "poderoso", proxima: { faixa: "mitico", falta: 0.663 }, mercado: true,
  eixos: { iv: 0.29, qualidade: 0.21, potencia: 0, shiny: 0.5 },
  stats: [{ key: "atk", valor: 504, pct: 0.21 }, { key: "hp", valor: 476, pct: 0.19 }, { key: "spDef", valor: 461, pct: 0.19 }, { key: "def", valor: 434, pct: 0.18 }, { key: "speed", valor: 321, pct: 0.13 }, { key: "spAtk", valor: 260, pct: 0.11 }],
  finais: [{ pokeId: 389, name: "Torterra", looktype: 60389, nota: 6.747, faixa: "poderoso", mercado: true }, { pokeId: 3389, name: "Mega Torterra", looktype: 80389, nota: 5.1, faixa: "forte", mercado: false }],
  combate: { mult: 3, potencia: 1, shiny: 3, lendario: null, poderRanking: 118, poderGinasio: 1, nivelGinasio: 20 },
};

export function startMockChat(emit: (ev: ChatEvent) => void) {
  chatEmit = emit;
  const seed = {
    mundo: [
      mockMsg("mundo", "Vanz1n", 539, "brabo, bater em área ajuda mt", "msg", 12, { cargo: "vip", guild: "DL", guildColor: "#4dd0ff" }),
      mockMsg("mundo", "burnato", 4157, "Dúvidas onde farmar? pokeidleguide.io/#hunt Acesse aqui e informe seu pokemon!", "msg", 11, { cargo: "helper", guild: "TFT", guildColor: "#ff9f43" }),
      mockMsg("mundo", "Wakewakee", 1901, "⚔️ Derrotei 31.216 Riolu, ✅ capturei 755, ✨ vi 6 shinys e ✨ capturei 0 shinys!", "msg", 10, { cargo: "compartilhar" }),
      mockMsg("mundo", "Liang", 10, "mostrou o Pokémon Leafeon", "share", 9, { cargo: "compartilhar", pk: { nick: "Liang", id: 5151, label: "Leafeon" } }),
      mockMsg("mundo", "Diule_JR", 1306, "clk", "msg", 9, { guild: "FON", guildColor: "#6fd47c" }),
      mockMsg("mundo", "JalyTorey", 3312, "", "ad", 8, { cargo: "anuncio", ad: { qtd: 1, nome: "Blastoise Nv 80", preco: "450", moeda: "gemas", id: 7 } }),
      mockMsg("mundo", "Benzaquen", 4818, "", "ad", 7, { cargo: "anuncio", ad: { qtd: 1, nome: "Mega Garchomp", preco: "25.999", moeda: "gemas", id: 8888 } }),
      mockMsg("mundo", "Dubas", 2944, "", "ad", 7, { cargo: "anuncio", ad: { qtd: 3, nome: "Rare Candy", preco: "100.000", moeda: "gold", id: 9999 } }),
      mockMsg("mundo", "✨ Shiny", null, "✨ Luskashi33 capturou um Gengar shiny!", "shiny", 5, { cargo: "shiny", pk: { nick: "Luskashi33", id: 4242, label: "Gengar" } }),
      mockMsg("mundo", "🏷️ Tag IDLE", null, "🏷️ O jogador Mhynx resgatou 5 diamantes utilizando a TAG IDLE no Discord, venha receber também!", "msg", 4, { cargo: "anuncio" }),
      mockMsg("mundo", "Noyan", 257, "@Treinador1 saquei, vlw", "msg", 2, { guild: "DL", guildColor: "#4dd0ff" }),
      mockMsg("mundo", "Syfras999", 2110, "@junitsu bora trocar aquela Rare Candy?", "msg", 1),
    ],
    comercio: [mockMsg("comercio", "Dubas", 2944, "vendo Sun Stone 69k cada, chama no privado", "msg", 5), mockMsg("comercio", "Ana", 1200, "compro Leaf Stone até 49k", "msg", 3)],
    duvidas: [mockMsg("duvidas", "Novato", 45, "como eu troco de hunt quando está em combate?", "msg", 7)],
  };
  emit({ type: "init", messages: seed });
  const pool = ["alguém sabe quando abre a próxima raid?", "boa noite, treinadores", "vendi meu Dragonite por 30k", "esse mapa de Outland tá rendendo muito", "compro Revive em quantidade"];
  let n = 0;
  setInterval(() => emit({ type: "chat", msg: mockMsg("mundo", ["Pedro", "Marina", "Kaue"][n % 3], 500 + n * 13, pool[n++ % pool.length]) }), 9000);
}

/** Simula as rotas de ação do backend (equipar, caçar, mapa) para o modo de dados falsos. */
function installMockApi(accs: AccountSnapshot[]) {
  const SPECIES = [
    ["Bellsprout", ["GRASS", "POISON"], 69], ["Caterpie", ["BUG"], 10], ["Geodude", ["ROCK", "GROUND"], 74], ["Magikarp", ["WATER"], 129],
    ["Oddish", ["GRASS", "POISON"], 43], ["Paras", ["BUG", "GRASS"], 46], ["Pidgey", ["NORMAL", "FLYING"], 16], ["Poliwag", ["WATER"], 60],
    ["Rattata", ["NORMAL"], 19], ["Weedle", ["BUG", "POISON"], 13], ["Abra", ["PSYCHIC"], 63], ["Diglett", ["GROUND"], 50],
    ["Goldeen", ["WATER"], 118], ["Horsea", ["WATER"], 116], ["Krabby", ["WATER"], 98], ["Slowpoke", ["WATER", "PSYCHIC"], 79],
  ] as const;
  const creatures: Record<string, unknown> = {};
  SPECIES.forEach(([n, t, id]) => (creatures[String(id)] = { n, t, l: ["Strange Pheromone", "Leaf Stone", "Small Stone"], lk: 25 + id }));
  const regions: [string, number][] = [["kanto", 1], ["outland", 150], ["johto", 200], ["hoenn", 500], ["sinnoh", 1000], ["unova", 5000]];
  const hunts = regions.flatMap(([area, base], r) =>
    SPECIES.map(([n, , id], k) => ({
      slug: k < 4 && r === 0 ? n.toLowerCase() : `${area}-${n.toLowerCase()}`,
      nome: r === 1 ? `Brave ${n}` : n, area: area === "kanto" || area === "outland" ? area : "orre", regiao: area, nivel: base + k * 10, totalSpawns: 15, looktype: null,
      especies: [{ pokeId: id, nome: n, pontos: 15 }],
    })),
  );
  const mockSettings = { ws_url: "wss://pokeidle.io", report_hour: 0, report_tz: "America/Sao_Paulo", public_url: "", hasWebhook: true, webhookHint: "abc…", alert_sell: true, alert_sell_pct: 30, alert_sold: true, external_login_wait_min: 5, defaultWsUrl: "wss://pokeidle.io" };
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
  const real = window.fetch.bind(window);
  let realHunts: Promise<unknown[]> | null = null;
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, location.href).pathname;
    const wait = () => new Promise((r) => setTimeout(r, 350));
    if (path === "/api/hunts") {
      // Dev: usa as hunts reais do Hub (mesmos slugs do jogo), para a "Melhor hunt" casar com o mapa. Sem rede, cai nas de mentira.
      realHunts ??= real("https://pokeidle-gg.pages.dev/data/jogo/hunts.json")
        .then((r) => r.json())
        .then((d: { hunts: { slug: string; nome: string; regiao: string; nivel: number; especies: { pokeId: number; pontos: number }[] }[] }) =>
          d.hunts.map((h) => ({ slug: h.slug, nome: h.nome, area: h.regiao === "kanto" || h.regiao === "outland" ? h.regiao : "orre", regiao: h.regiao, nivel: h.nivel, totalSpawns: 15, looktype: null, especies: h.especies.map((e) => ({ ...e, nome: h.nome })) })))
        .catch(() => hunts);
      const list = await realHunts;
      const tiers = [[1, 150, 1], [2, 1000, 1.25], [3, 2000, 1.5], [4, 4000, 2], [5, 8000, 3], [6, 16000, 4], [7, 24000, 6], [8, 36000, 8]].map(([tier, nivel, m]) => ({ tier, rotulo: `Outland ${tier}`, nivel, mult: m }));
      return json({ account: "acc1", level: 2104, current: "bellsprout", hunts: list, outland: { tiers, tier: accs[0].map?.outland?.tier ?? 1 } });
    }
    if (path === "/api/market/rules") {
      // Sniper do mock: uma regra antiga (1 conta) e uma com as contas todas.
      return json({
        sniperEnabled: true,
        rules: [
          { id: 1, kind: "snipe", enabled: true, label: "Sun Stone", lastFire: null, spentToday: 12000, spec: { target: "item", item_id: 23, moeda: "gold", max_price: 800, below_avg_pct: 0, account_id: 1, qty_max: 0, budget_daily: 0, poll_s: 10 } },
          { id: 2, kind: "snipe", enabled: true, label: "Rare Candy", lastFire: null, spentToday: 2400000, spec: { target: "item", item_id: 24, moeda: "gold", max_price: 100000, below_avg_pct: 0, account_id: 1, account_ids: accs.map((a) => Number(a.id.replace(/\D/g, ""))), qty_max: 0, budget_daily: 1000000, poll_s: 10 } },
          { id: 3, kind: "alert", enabled: true, label: "Pikachu shiny", lastFire: null, spentToday: 0, spec: { target: "pokemon", busca: "Pikachu", so_shiny: true, moeda: "gold", max_price: 5000, below_avg_pct: 0 } },
          { id: 4, kind: "snipe", enabled: true, label: "Qualquer Pokémon shiny", lastFire: null, spentToday: 0, spec: { target: "pokemon", busca: "", so_shiny: true, moeda: "gold", max_price: 100000000, below_avg_pct: 0, account_id: 1, account_ids: [1, 2, 3, 4], qty_max: 0, budget_daily: 0, poll_s: 10 } },
        ],
      });
    }
    if (path === "/api/market/log") {
      const st = ["comprado", "perdeu_sorteio", "perdeu_sorteio", "comprado", "recusado"];
      return json({
        log: Array.from({ length: 28 }, (_, i) => ({
          id: 100 - i, ts: Date.now() / 1000 - i * 95, accountId: (i % 4) + 1, ruleId: 2, status: st[Math.floor(i / 4) % 5],
          text: `${6 - (i % 3)}× Rare Candy a ${Math.floor(i / 4) % 2 ? 490 : 100000} ${Math.floor(i / 4) % 2 ? "Gemas" : "Gold"} (#${1129124 - Math.floor(i / 4)})` + (st[Math.floor(i / 4) % 5] === "recusado" ? " — saldo insuficiente" : ""),
        })),
      });
    }
    if (path === "/api/market/overview") {
      const it = (id: number, name: string, minGold: number | null, minOrb: number | null, avgGold: number | null, avgOrb: number | null) => ({ id, name, category: "stone", icon: null, ads: 3, units: 12, minGold, minOrb, avgGold, avgOrb, fav: false });
      return json({ ts: Date.now(), days: 7, online: [1], items: [it(23, "Sun Stone", 68999, 410, 74500, 450), it(24, "Rare Candy", 100000, null, 112000, null), it(25, "Leaf Stone", 49005, 300, 52000, 320), it(26, "Fire Stone", 51000, 310, 55000, 330), it(27, "Moon Stone", null, null, 80000, null)] });
    }
    if (path === "/api/creatures") return json(creatures);
    if (path === "/api/pvp" && (!init?.method || init.method === "GET")) {
      const tiers = [["bronze", "I", 40, 5], ["ouro", "II", 745, 41], ["diamante", "III", 1390, 120], ["bronze", "I", 0, 0]] as const;
      return json({
        ts: Date.now(),
        accounts: accs.map((a, i) => {
          const [tierId, divisaoNum, pontos, partidas] = tiers[i];
          return {
            id: i + 1, nick: a.nick, level: a.level, online: a.status !== "offline", vip: i === 1, auto: pvpAuto[i], nativeAuto: false, levelMin: 150,
            blocker: a.status === "offline" ? "offline" : i === 3 ? "team" : null, blockerText: i === 3 ? "Monte a equipe de PVP no jogo antes de entrar na fila." : null,
            rank: { pontos, pico: pontos, vitorias: Math.round(partidas * 0.55), derrotas: Math.round(partidas * 0.45), partidas, tierId, divisaoNum, de: 600, ate: 700, progresso: 0.45, naFaixa: 45, larguraFaixa: 100, escudo: i === 2 ? 1 : 0 },
            position: i === 2 ? 4212 : null, totalRanked: 13509,
            team: i === 3 ? [] : [60003, 60248, 60094, 60130, 60025].slice(0, 5 - (i % 2)).map((looktype, k) => ({ id: k + 1, name: "Pokémon", level: 800 + k * 130, looktype, shiny: false, types: [], power: 3000 })),
            queue: { on: i === 0, since: Date.now() - 42_000, size: 6386, waitMs: i === 1 ? 12_000 : 0 },
            refusal: null,
            session: { wins: i === 1 ? 4 : 0, losses: i === 1 ? 2 : 0, delta: i === 1 ? 31 : 0, matches: i === 1 ? [10, 11, -8, 9, 10, -7].map((d, k) => ({ id: k, won: d > 0, delta: d, opponent: `Rival${k}`, at: Date.now() })) : [] },
            history: [10, 11, 11, -9].map((d, k) => ({ id: 100 + k, won: d > 0, delta: d, opponent: `Selux${k}`, at: "2026-11-14T19:33:33Z" })),
          };
        }),
      });
    }
    if (path === "/api/market/vitrine") {                  // vitrine de Pokémon do modo de demonstração (formato real do servidor)
      const ficha = { id: 176926002, xp: 15694800, ivs: { hp: 31, atk: 25, def: 28, spAtk: 11, spDef: 19, speed: 8 }, nome: "Furious Scizor", nota: 3.58, level: 100, maxHp: 2808, poder: 366, shiny: false, stats: { hp: 234, atk: 294, def: 254, spAtk: 126, spDef: 192, speed: 143 }, tipos: ["BUG", "STEEL"], refino: { hp: 0, atk: 0, def: 0, spAtk: 0, spDef: 0 }, apelido: null, ivTotal: 122, quality: 1.734, caughtAt: 1795130280057, looktype: 60212, potencia: 2, lookShiny: null, speciesId: 2050, refinoTotal: 0, tmElemental: null, caughtBy: "Nitrixon04" };
      const listings = [0, 1, 2].map((i) => ({ id: 1691538 + i, expiraEm: Date.now() + 86_400_000, dias: 1, vendedor: ["Nitrixon04", "Dubas", "Ana"][i], vendedorId: 135408 + i, tipo: "pokemon", itemId: null, pokemonId: 176926002 + i, qtd: 1, ficha: { ...ficha, id: 176926002 + i, level: 100 + i * 40, ...(i === 1 ? { nome: "Mega Tyranitar", shiny: true, looktype: 80248, lookShiny: 85248 } : {}) }, preco: 39_000_000 - i * 4_000_000, moeda: "gold", estado: "aberto", criadoEm: Date.now() - 600_000, compravelEm: Date.now() - 1000, editavelEm: Date.now() + 600_000, comprador: null, favoritos: 0 }));
      return json({ now: Date.now(), total: 3, page: 0, perPage: 20, listings });
    }
    if (path === "/api/sprite-atlas") return json({ cell: 64, cols: 16, rows: 1, version: "mock", image: "https://pokeidle.io/assets/site/assets/maps/marker-atlas.png", slots: {} });
    if (path.startsWith("/api/sprite/")) {                // sprite de outfit (Mega/shiny): o servidor real devolve o quadro da página do jogo
      const lt = Number(path.split("/").pop());
      if (lt === 1) return json({ error: "esse looktype não tem sprite" }, 404);
      return json({ image: "https://pokeidle.io/assets/asset-packs/outfits/male/80248/outfits-male-80248-00-4b1d43b135e5.webp", pageW: 4094, pageH: 66, x: 398, y: 2, w: 64, h: 64 });
    }
    if (path === "/api/pokemons") {                       // inventário de Pokémon do modo de demonstração
      const names = ["Tyranitar", "Venusaur", "Gengar", "Mamoswine", "Dragonite", "Scizor"];
      const looks = [60248, 60003, 60094, 60473, 60149, 60212];
      const pokemons = Array.from({ length: 24 }, (_, i) => ({ id: 3289961 + i, account: accs[i % accs.length].id, speciesId: 248, name: names[i % 6], types: ["ROCK", "DARK"], level: 2100 - i * 31, shiny: i % 7 === 3, quality: [1.0, 1.28, 1.578, 1.45, 1.72, 0.95][i % 6], power: 82000 - i * 1500, grade: 4.6 - i * 0.05, slot: i < 3 ? i : null, ivTotal: [60, 98, 132, 156, 178, 188][i % 6], potency: 1 + (i % 5), caughtAt: 1789099341577, looktype: looks[i % 6] }));
      return json({ pokemons });
    }
    if (path.startsWith("/api/pokemon/")) {                // ficha de Pokémon de outros jogadores (chat e mercado)
      await wait();
      const q = new URL(url, location.href).searchParams;
      if (path.startsWith("/api/pokemon/listing/") && path.endsWith("/9999")) return json({ error: "Esse anúncio é de item, não de Pokémon.", code: "item" }, 422);
      const sent = path.endsWith("/sheet") && init?.body ? (JSON.parse(String(init.body)) as { pokemon?: { dono?: string }; listing?: unknown }) : null;
      if (path.endsWith("/8888")) {                          // forma Mega: o catálogo de espécies não tem
        return json({ owner: "Benzaquen", listing: { id: 8888, price: 25999, currency: "orb", qty: 1 }, species: null, range: 1, evolution: { prev: null, next: null, level: 0, prevLevel: 0 }, pokedex: { defeated: null, captured: null }, foundIn: [], bases: null,
          pokemon: { id: 1, speciesId: 9999, nome: "Mega Garchomp", looktype: 60212, lookShiny: null, tipos: ["DRAGON", "GROUND"], level: 400, xp: 15694800, quality: 1.9, potencia: 3, shiny: false, slot: null, maxHp: 9000, poder: 5000, nota: 5.2, ivs: { hp: 31, atk: 25, def: 28, spAtk: 11, spDef: 19, speed: 8 }, stats: { hp: 900, atk: 994, def: 754, spAtk: 426, spDef: 592, speed: 543 }, refino: {}, refinoTotal: 0, tmElemental: null, caughtAt: 1795130280057, caughtBy: "Benzaquen" },
          combatHp: 10800, pvpPower: 0, pvpLevel: 300, pvePower: 0 });
      }
      const owner = sent?.pokemon?.dono ?? (path.endsWith("/public") ? q.get("nick") : "JalyTorey");
      const sp = { pokeId: 2050, name: "Scizor", looktype: 60212, type1: "BUG", type2: "STEEL", rarity: "RARE", baseHp: 70, baseAtk: 130, baseDef: 100, baseSpAtk: 55, baseSpDef: 80, baseSpeed: 65, huntLevel: 90, evolvesToId: 0, evolveLevel: 0, sellValue: 9000, experience: 1200, loot: [], attacks: [{ name: "Fury Cutter", type: "BUG", power: 80, category: "PHYSICAL", cooldownMs: 22000, learnLevel: 1 }] };
      return json({
        owner, ...(path.startsWith("/api/pokemon/listing/") ? { listing: { id: 7, price: 450, currency: "orb", qty: 1 } } : sent?.listing ? { listing: sent.listing } : {}),
        species: sp, range: 1, evolution: { prev: null, next: null, level: 0, prevLevel: 0 }, pokedex: { defeated: null, captured: null }, foundIn: [{ slug: "scizor", name: "Scizor", level: 90, points: 12 }],
        pokemon: { id: 176926002, speciesId: 2050, nome: "Furious Scizor", looktype: 60212, lookShiny: null, tipos: ["BUG", "STEEL"], level: 100, xp: 15694800, quality: 1.734, potencia: 2, shiny: false, slot: null, maxHp: 2808, poder: 366, nota: 3.58, ivs: { hp: 31, atk: 25, def: 28, spAtk: 11, spDef: 19, speed: 8 }, stats: { hp: 234, atk: 294, def: 254, spAtk: 126, spDef: 192, speed: 143 }, refino: { hp: 0, atk: 0, def: 0, spAtk: 0, spDef: 0 }, refinoTotal: 0, tmElemental: null, caughtAt: 1795130280057, caughtBy: owner },
        calc: mockCalc, combatHp: 2808, pvpPower: 3116, pvpLevel: 100, pvePower: 366000, bases: { hp: 70, atk: 130, def: 100, spAtk: 55, spDef: 80, speed: 65 },
      });
    }
    const pvpApiM = path.match(/^\/api\/pvp\/(\d+)\/(roster|team-view|team|pokemon\/\d+)$/);
    if (pvpApiM || path.startsWith("/api/pvp/species/")) {
      const row = (i: number) => ({ id: 1000 + i, speciesId: 1 + (i % 150), name: ["Tyranitar", "Venusaur", "Gengar", "Mamoswine", "Dragonite", "Lapras", "Barboach", "Togekiss"][i % 8], level: 2100 - i * 53, looktype: [60248, 60003, 60094, 60473, 60149, 60131, 60339, 60468][i % 8], shiny: i % 9 === 4, types: [["ROCK", "DARK"], ["GRASS", "POISON"], ["GHOST", "POISON"], ["ICE", "GROUND"], ["DRAGON", "FLYING"], ["WATER", "ICE"], ["WATER", "GROUND"], ["FAIRY", "FLYING"]][i % 8], pvpPower: 82000 - i * 2300, pvpLevel: 480 - i * 6, power: 8000 - i * 150, quality: [1.0, 1.28, 1.578, 1.45, 1.72, 0.95][i % 6], potency: 1 + (i % 5), grade: [2.4, 3.3, 3.457, 5.7, 7.2, 8.8][i % 6], ivTotal: [60, 98, 132, 156, 178, 188][i % 6], range: [1, 2, 4, 1, 1, 3, 1, 4][i % 8], hunting: i < 3, inTeam: i < 3, refined: false });
      if (path.endsWith("/roster")) { await wait(); const rows = Array.from({ length: 140 }, (_, i) => row(i)); const sp = new URL(url, location.href).searchParams; const off = Number(sp.get("offset") || 0); return json({ total: rows.length, owned: rows.length, offset: off, items: rows.slice(off, off + 60) }); }
      if (path.endsWith("/team-view")) return json({ ids: [1000, 1001, 1002], casas: { "1000": 2, "1001": 8, "1002": 23 }, members: [row(0), row(1), row(2)] });
      if (path.endsWith("/team") && init?.method === "POST") { await wait(); return json({ ok: true }); }
      const atk = (name: string, type: string, power: number, category: string, cd: number) => ({ name, type, power, category, cooldownMs: cd, learnLevel: 1 });
      const species = { pokeId: 248, name: "Tyranitar", looktype: 416, type1: "ROCK", type2: "DARK", rarity: "EPIC", baseHp: 100, baseAtk: 134, baseDef: 110, baseSpAtk: 95, baseSpDef: 100, baseSpeed: 61, huntLevel: 100, evolvesToId: 0, evolveLevel: 0, sellValue: 62500, experience: 6008, loot: [{ name: "Rock Stone", chance: 143, minCount: 1, maxCount: 1 }, { name: "Small Stone", chance: 45961, minCount: 1, maxCount: 5 }], attacks: [atk("Rock Throw", "ROCK", 96, "PHYSICAL", 29100), atk("Bite", "DARK", 72, "PHYSICAL", 23400), atk("Crumbling Rain", "ROCK", 600, "PHYSICAL", 60000)] };
      const common = { species, range: 1, evolution: { prev: { pokeId: 247, name: "Pupitar", looktype: 401 }, next: null, level: 0, prevLevel: 100 }, pokedex: { defeated: 25, captured: 1 }, foundIn: [{ slug: "tyranitar", name: "Tyranitar", level: 470, points: 15 }] };
      if (path.startsWith("/api/pvp/species/")) return json(common);
      await wait();
      return json({ ...common, pokemon: { id: 3289961, speciesId: 248, nome: "Tyranitar", looktype: 60248, lookShiny: null, tipos: ["ROCK", "DARK"], level: 2064, xp: 146304204535, xpNivel: 146121877400, xpProximo: 146334572800, quality: 1.711, potencia: 1, shiny: false, slot: 2, hp: 48190, maxHp: 55284, poder: 8479, nota: 3.651, ivs: { hp: 17, atk: 23, def: 20, spAtk: 28, spDef: 32, speed: 32 }, stats: { hp: 4607, atk: 5741, def: 4758, spAtk: 4789, spDef: 5202, speed: 4297 }, refino: { hp: 0, atk: 1, def: 0, spAtk: 0, spDef: 0 }, refinoTotal: 1, tmElemental: null, caughtAt: 1789099341577, caughtBy: true }, calc: mockCalc, combatHp: 55284, pvpPower: 82354, pvpLevel: 488, pvePower: 26161752, bases: { hp: 100, atk: 135, def: 110, spAtk: 95, spDef: 100, speed: 61 } });
    }
    if (path === "/api/pvp/ladder") {
      const pg = Number(new URL(url, location.href).searchParams.get("pagina") || 1);
      const rows = Array.from({ length: 100 }, (_, k) => ({ pos: (pg - 1) * 100 + k + 1, nick: k === 3 ? "Treinador3" : `Jogador${(pg - 1) * 100 + k + 1}`, tier: pg > 2 ? "diamante" : "mestre", division: pg > 2 ? "III" : "", points: 6200 - (pg - 1) * 90 - k, wins: 1600 - k, losses: 1500 + k }));
      return json({ page: pg, pages: 10, week: "2026-11-15", rows, at: Date.now() });
    }
    const pvpAutoM = path.match(/^\/api\/pvp\/(\d+)\/(auto|queue)$/);
    if (pvpAutoM && init?.method === "POST") {
      await wait();
      if (pvpAutoM[2] === "auto") pvpAuto[Number(pvpAutoM[1]) - 1] = JSON.parse(String(init.body)).on;
      return json({ ok: true });
    }
    if (path === "/api/pvp/auto" && init?.method === "POST") {
      await wait();
      pvpAuto.fill(JSON.parse(String(init.body)).on);
      return json({ ok: true, accounts: 4 });
    }
    if (path === "/api/community") return json({ url: "https://discord.gg/pFVashEjtH", name: "Pokeidle Manager", online: 8, members: 32 });
    if (path === "/api/chat/send" && init?.method === "POST") {
      await wait();
      const b = JSON.parse(String(init.body)) as { account: number; canal: string; texto: string };
      if (Date.now() - lastSendAt < 3000) return json({ error: "Calma: aguarde 3 s para enviar de novo.", code: "rate", wait: 3 }, 429);
      if (/https?:\/\/|www\./i.test(b.texto)) return json({ error: "Links não são permitidos no chat.", code: "link", wait: 0 }, 400);
      lastSendAt = Date.now();
      const a = accs[b.account - 1];
      chatEmit?.({ type: "chat", msg: mockMsg(b.canal, a?.nick ?? "Você", a?.level ?? 1, b.texto) });
      return json({ ok: true });
    }
    const sheetM = path.match(/^\/api\/accounts\/(\d+)\/sheet$/);
    if (sheetM) {
      await wait();
      // A ficha do exemplo do jogo (Scizor Nv 100), a mesma para todas as contas do mock.
      return json({
        id: 1, speciesId: 212, nome: "Scizor", looktype: 370, level: 100, shiny: false, quality: 1.796, potencia: 3, tmAoe: false, trainerLevel: 300,
        stats: { hp: 188, atk: 264, def: 190, spAtk: 202, spDef: 218, speed: 175 }, ivs: { hp: 14, atk: 10, def: 4, spAtk: 30, spDef: 22, speed: 13 },
      });
    }
    const passClaim = path.match(/^\/api\/accounts\/(\d+)\/pass\/claim$/);
    if (passClaim && init?.method === "POST") {
      await wait();
      return json({ ok: true, confirmed: true, claim: { degrau: 7, premios: [{ trilha: "free", tipo: "coins", qtd: 1_000_000 }, { trilha: "free", tipo: "boost", boost: "loot", horas: 1 }] } });
    }
    if (path === "/api/accounts" && (!init?.method || init.method === "GET")) return json({ max: 4, accounts: [] });
    if (path === "/api/login-window") {
      if (init?.method === "POST") {
        await wait();
        return json({ ok: true, nick: "Ash_Ketchum", loginId: "mock-login" });
      }
      return json({ available: true });
    }
    const tierRoute = path.match(/^\/api\/accounts\/(\d+)\/outland-tier$/);
    if (tierRoute && init?.method === "POST") {
      await wait();
      const tier = JSON.parse(String(init.body)).tier as number;
      const a = accs[Number(tierRoute[1]) - 1];
      if (a?.map?.outland) a.map = { region: "outland", label: `Outland ${tier}`, outland: { tier, label: `Outland ${tier}`, mult: 1 + (tier - 1) * 0.25 } };
      return json({ ok: true, confirmed: true, tier });
    }
    if (path === "/api/settings") {
      if (init?.method === "PUT") Object.assign(mockSettings, JSON.parse(String(init.body)));
      return json(mockSettings);
    }
    if (path === "/api/session/reset" && init?.method === "POST") {
      await wait();
      for (const a of accs) a.session = { startedAt: Date.now(), items: { boss: 0, key: 0, shinyStone: 0, bike: 0 } };
      return json({ ok: true, reset: accs.map((a) => a.id) });
    }
    let m = path.match(/^\/api\/accounts\/(\d+)\/equip$/);
    if (m && init?.method === "POST") {
      await wait();
      const { kind, id } = JSON.parse(String(init.body)) as { kind: "ball" | "potion"; id: number };
      const a = accs[Number(m[1]) - 1];
      const opt = a.equipped!.options![kind].find((o) => o.id === id)!;
      a.equipped![kind] = { ...opt };
      return json({ ok: true, stock: opt.qty, willBuy: opt.qty < 100, restockEnabled: true, buyable: id !== 5 });
    }
    m = path.match(/^\/api\/accounts\/(\d+)\/hunt\/queue$/);
    if (m && init?.method === "DELETE") {
      accs[Number(m[1]) - 1].huntPending = null;
      return json({ ok: true });
    }
    m = path.match(/^\/api\/accounts\/(\d+)\/hunt$/);
    if (m && init?.method === "POST") {
      await wait();
      const { slug } = JSON.parse(String(init.body)) as { slug: string };
      const a = accs[Number(m[1]) - 1];
      if (slug.includes("hoenn")) return json({ ok: true, confirmed: false, slug });
      const h = hunts.find((x) => x.slug === slug);
      const until = (window as unknown as { __mockLock?: Record<string, number> }).__mockLock?.[a.id] ?? 0;
      if (until > Date.now()) {
        // Em combate: entra na fila e troca sozinho quando a trava acabar.
        a.huntPending = { slug, name: h?.nome ?? slug };
        setTimeout(() => {
          if (a.huntPending?.slug !== slug) return;
          a.hunt = { slug, kills: 0, minutes: 0 };
          a.huntName = h?.nome ?? slug;
          a.huntPending = null;
        }, until - Date.now() + 300);
        return json({ ok: true, confirmed: false, queued: true, waitMs: until - Date.now(), slug });
      }
      a.hunt = { slug, kills: 0, minutes: 0 };
      a.huntName = h?.nome ?? slug;
      return json({ ok: true, confirmed: true, slug });
    }
    return real(input, init);
  };
}

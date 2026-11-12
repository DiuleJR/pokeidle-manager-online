import type { AccountSnapshot, ConnectionState, SnapshotMessage } from "./types";

/** Gerador de dados falsos (VITE_MOCK=1) para desenvolver a UI sem backend. */
export function startMock(emit: (m: SnapshotMessage) => void, setState: (s: ConnectionState) => void) {
  const names = ["Pikachu", "Charizard", "Gengar", "Snorlax"];
  const statuses: AccountSnapshot["status"][] = ["online", "online", "paused_cooldown", "offline"];
  const accs: AccountSnapshot[] = names.map((p, i) => ({
    id: `acc${i + 1}`,
    nick: `Treinador${i + 1}`,
    level: 40 + i * 7,
    status: statuses[i],
    pokemon: { name: p, hp: 100, maxHp: 100 },
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
      return json({ account: "acc1", level: 1265, current: "bellsprout", hunts: list });
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
    const sheetM = path.match(/^\/api\/accounts\/(\d+)\/sheet$/);
    if (sheetM) {
      await wait();
      // A ficha do exemplo do jogo (Scizor Nv 100), a mesma para todas as contas do mock.
      return json({
        id: 1, speciesId: 212, nome: "Scizor", looktype: 370, level: 100, shiny: false, quality: 1.796, potencia: 3, tmAoe: false, trainerLevel: 300,
        stats: { hp: 188, atk: 264, def: 190, spAtk: 202, spDef: 218, speed: 175 }, ivs: { hp: 14, atk: 10, def: 4, spAtk: 30, spDef: 22, speed: 13 },
      });
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

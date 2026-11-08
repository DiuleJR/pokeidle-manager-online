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
      }
    }
    emit({ type: "snapshot", ts: Date.now(), accounts: accs.map((a) => ({ ...a, pokemon: a.pokemon && { ...a.pokemon } })) });
  };
  tick();
  setInterval(tick, 1000);
}

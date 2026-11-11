// Worker da "Melhor hunt" (aba Mapa). Roda o motor da calculadora de hunt do PokéIdle Hub
// (https://pokeidle-gg.pages.dev), carregado do site deles na hora: o código NÃO é copiado para este projeto.
//
// Segurança: este arquivo é servido com uma CSP própria (ver telemetry.py) que só permite falar com o
// site do Hub. Mesmo sendo da mesma origem do painel, o código de fora não consegue chamar a nossa API.
// Entrada: o Pokémon equipado (já com os stats do jogo) e o nível do treinador. Nada disso sai do navegador.
const HUB = "https://pokeidle-gg.pages.dev";
const BLOCO = 100;
const ZERO = { hp: 0, atk: 0, def: 0, spAtk: 0, spDef: 0, speed: 0 };

let pronto = null;
const carregar = () =>
  (pronto ??= (async () => {
    const [cat, hun, sim] = await Promise.all([
      import(`${HUB}/js/jogo/catalogo.js`),
      import(`${HUB}/js/jogo/hunts.js`),
      import(`${HUB}/js/jogo/simulador.js`),
    ]);
    const jogo = await cat.carregarJogo();
    const dados = await fetch(`${HUB}/data/jogo/hunts.json`, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`hunts.json: ${r.status}`);
      return r.json();
    });
    const { hunts } = hun.prepararHunts(dados, jogo);
    return { jogo, hunts, sim: sim.criarSimulador(jogo, hunts) };
  })().catch((e) => {
    pronto = null; // tenta de novo na próxima vez
    throw e;
  }));

const leve = (l) => ({
  slug: l.slug, nome: l.nome, regiao: l.regiao, nivel: l.nivel, liberada: !!l.liberada, inviavel: !!l.inviavel,
  xpPokemonH: l.xpPokemonH ?? 0, xpTreinadorH: l.xpTreinadorH ?? 0, ouroH: l.ouroH ?? 0, kph: l.kph ?? 0,
  mortesH: l.mortesH ?? 0, umHit: !!l.umHit, hitPct: l.hitPct ?? 0, ritmo: l.ritmo ?? null, aoe: !!l.aoe,
  melhorGolpe: l.melhorGolpe ?? null,
});

async function calcular({ sheet, nivelTreinador }) {
  const d = await carregar();
  const esp = d.jogo.especies.get(sheet.speciesId);
  if (!esp) throw new Error(`a espécie #${sheet.speciesId} não está no catálogo do Hub`);
  const pokemon = {
    esp,
    nascimento: { ivs: { ...sheet.ivs }, qualidade: sheet.quality, potencia: sheet.potencia, shiny: !!sheet.shiny, refino: { ...ZERO } },
    statsInformados: { ...sheet.stats },
    nivelDosStats: sheet.level,
    tmAoe: !!sheet.tmAoe,
  };
  let linhas = [];
  for (let i = 0; i < d.hunts.length; i += BLOCO) {
    const r = d.sim.analisarHunts({
      pokemon, nivelPokemon: sheet.level, nivelTreinador, hunts: d.hunts.slice(i, i + BLOCO),
      soLiberadas: false, comPocao: true,
    });
    linhas = linhas.concat(r.linhas.map(leve));
  }
  return { versao: d.jogo.versao ?? null, total: linhas.length, linhas };
}

self.onmessage = async ({ data }) => {
  const { id, entrada } = data;
  try {
    self.postMessage({ id, ok: true, dados: await calcular(entrada) });
  } catch (err) {
    self.postMessage({ id, ok: false, erro: String(err?.message ?? err) });
  }
};

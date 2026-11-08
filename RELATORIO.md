# Relatório — pokeidle-manager-vps

> Estado do projeto em 2026-11-08. Reescrita de um bot headless em Python
> para gerenciar até 4 contas simultâneas do jogo pokeidle.io, pensado para
> rodar em background numa VPS Linux via Docker (sem interface gráfica ou
> navegador).

## 1. Visão geral

| Item | Status |
| --- | --- |
| Conexão WebSocket (handshake, heartbeat, reconexão) | ✅ implementado e testado ao vivo |
| Cooldown por login externo (code `4001`) | ✅ implementado e confirmado por teste real |
| Combate/hunt (passivo, server-driven) | ✅ implementado e testado ao vivo |
| Captura automática de Balls | ✅ implementado e testado ao vivo (captura real registrada) |
| Reposição automática de Potion | ✅ implementado; restock ainda não disparou em teste (estoque sempre acima do limite) |
| Visão de inventário por conta | ✅ implementado e testado ao vivo |
| Suporte a proxy ISP/residencial por conta | ✅ implementado; **não testado com proxy real** (só modo direto) |
| Venda de Pokémon / Market / Automations (docs 04, 05, 06, 08, 10, 11) | ⛔ não implementado — docs ainda não lidos |

## 2. Docs lidos até agora (só o que foi pedido explicitamente)

- Spec do protocolo: protocolo de sessão (`hello`/`welcome`)
- Spec do protocolo: seleção de hunt, Center, eventos de batalha
- Spec do protocolo: captura (`ball.throw`)
- Spec do protocolo: compras na loja (`shop.buy`)
- Spec do protocolo: estrutura de `items`/`balls`/`pokemons`/`pokedex`

**Ainda não lidos:** `04-automations.md`, `05-friends-profile.md`,
`06-market.md`, `08-pokemon-sales.md`, `10-reference.md`, `11-xp-bonuses.md`.

## 3. Arquivos do projeto

| Arquivo | Responsabilidade |
| --- | --- |
| [config.py](config.py) | Carrega `.env`: até 4 contas (credenciais, proxy opcional, hunt alvo, flags de automação, config de potion/ball) |
| [connection.py](connection.py) | WebSocket por conta: túnel via proxy (ou direto), handshake, heartbeat, reconexão/cooldown, amarra hunt/balls/shop/inventory, logs de status |
| [hunt.py](hunt.py) | Merge de `estado` (incl. `pkMud` por id), processa `batalha.ev[]` (`hunt`/`ataque`/`morte`), expõe `hunt.select`/`centro.ir`, monta linha de status |
| [balls.py](balls.py) | Captura automática: fila FIFO de cadáveres, janela de 30s, cooldown de 1.3s entre `ball.throw`, escolhe ballId por prioridade configurável |
| [shop.py](shop.py) | `shop.buy` genérico + `AutoPotion` (repõe a Potion equipada via `heldItemId`, ou um ID fixo via `.env`) |
| [inventory.py](inventory.py) | Visão somente-leitura de `balls`/`items`/`pokemons`/`pokedex`, nomes conhecidos de Balls/Potions |
| [main.py](main.py) | Sobe as contas configuradas em paralelo (`asyncio.gather`) |
| [.env](.env) / [.env.example](.env.example) | Credenciais reais (git-ignorado) / template documentado de todas as variáveis |
| [Dockerfile](Dockerfile) | Imagem Python 3.12-slim, `.env` injetado em runtime |
| [requirements.txt](requirements.txt) | `websockets`, `aiohttp`, `aiohttp-socks`, `python-dotenv` |

## 4. Protocolo confirmado e em uso

### Cliente → Servidor
- `hello` (`t`, `nick`, `token`, `delta=1`, `dispositivo`)
- `hunt.select` (`slug`)
- `centro.ir`
- `ball.throw` (`ballId`, `slot`)
- `shop.buy` (`kind`: `"ball"`|`"item"`, `id`, `qty`)

### Servidor → Cliente
- `welcome` (snapshot inicial: `estado`, `hunts`)
- `estado` (patches parciais; `pkMud` mesclado por `id`)
- `campo.init`
- `batalha` (envelope com `ev[]`: `hunt`, `ataque`, `morte`, `bola`, `fugiu`, `centro`, `compra`)

### Combate
**Importante:** a spec não documenta nenhum frame de "atacar" — o combate é
100% narrado pelo servidor (idle game). O bot nunca envia ação de ataque,
só reage aos eventos.

## 5. Comportamentos confirmados por teste real (não só pela doc)

- **Close code `4001` = login externo.** Confirmado nos dois sentidos (bot
  expulsou o navegador da usuária; o navegador expulsou o bot de volta).
  Tratado com `PAUSED_COOLDOWN` de 5 minutos antes de reconectar.
- **`heldItemId` do Pokémon ativo = Potion equipada no jogo.** Confirmado
  pela usuária (conta com Golden Potion equipada tinha `heldItemId=70070`).
  Usado como padrão no `AutoPotion`.

Ambos salvos na memória do projeto para não precisar reconfirmar em
sessões futuras.

## 6. Configuração disponível (`.env` por conta, `ACCn_*`)

| Variável | Default | Finalidade |
| --- | --- | --- |
| `ACCn_NICK` / `TOKEN` / `DEVICE_ID` | obrigatórios | credenciais da conta |
| `ACCn_PROXY_HOST/PORT/USER/PASS/SCHEME` | vazio = sem proxy | proxy ISP dedicado |
| `ACCn_HUNT_SLUG` | vazio = mantém a atual | hunt a selecionar ao conectar |
| `ACCn_AUTO_CATCH` | `true` | liga/desliga captura automática |
| `ACCn_BALL_PRIORITY` | `1,2,3,4` | ordem de preferência de ballId |
| `ACCn_AUTO_POTION` | `true` | liga/desliga restock de Potion |
| `ACCn_POTION_ID` | vazio = usa `heldItemId` | fixa manualmente qual Potion repor |
| `ACCn_POTION_RESTOCK_THRESHOLD` | `50` | estoque mínimo antes de comprar |
| `ACCn_POTION_RESTOCK_QTY` | `200` | quantidade comprada por vez |

Globais: `WS_URL` (obrigatória), `EXTERNAL_LOGIN_CLOSE_CODES` (default
`4001,4003,1008`).

## 7. O que falta validar

- **Proxy real.** Só testamos em modo direto (sem proxy) até agora — o
  caminho via `aiohttp-socks`/`python-socks` nunca rodou com um proxy de
  verdade.
- **4 contas simultâneas.** Só testamos com a conta 1 isolada.
- **Restock de Potion em ação.** Nunca caiu abaixo do limite configurado
  durante os testes; a lógica está no código mas não foi observada
  disparando de verdade.
- **IDs de Potion 201–204 e Balls 2–3.** Seguem como 🟡 (mapeados pela
  ordem da loja, sem captura individual de compra confirmando cada um).

## 8. Limpeza feita nesta sessão

- Removidos `capture.py` e `har_to_frames.py` (scripts exploratórios de uma
  abordagem de captura de frames que foi abandonada em favor de ler os
  docs já existentes).
- Credenciais reais movidas de `.env.example` (rastreado) para `.env`
  (git-ignorado).

## 9. Próximos passos possíveis (aguardando decisão)

- Spec do protocolo: venda automática de Pokémon.
- Spec do protocolo: outras automações documentadas pelo jogo.
- Spec do protocolo: comércio entre jogadores.
- Spec do protocolo: bônus de XP.
- Testar com proxy real e com as 4 contas ao mesmo tempo.

# pokeidle-manager

Bot headless em Python para gerenciar até 4 contas do jogo **pokeidle.io** ao mesmo
tempo, pensado para rodar em background (na sua máquina ou numa VPS Linux, sem
navegador), com um painel web para acompanhar e configurar tudo.

> **Projeto não oficial.** Não tem relação com o pokeidle.io nem com seus
> desenvolvedores.
>
> Segundo os [Termos de Uso do jogo](https://pokeidle.io/terms#conduta) (seção
> "Conduta"), automações são permitidas, desde que sigam as mesmas regras de quem
> joga na mão. Ou seja, **não** podem:
>
> - explorar falhas (bugs) ou duplicar itens, Pokémon, Coins, diamantes ou Gemas;
> - burlar limites do jogo, como o de contas, ou as travas e retenções do Mercado;
> - sobrecarregar o servidor.
>
> **Limite de contas:** cada pessoa pode ter até **4 contas** no total, somando
> todas as redes e aparelhos. Cada rede também pode ter no máximo 4 contas
> conectadas ao mesmo tempo. Por isso o bot gerencia **no máximo 4 contas**.
> Passar disso pode banir todas as suas contas.
>
> Os termos podem mudar: leia a versão atual antes de usar. Você é o único
> responsável pelo uso que fizer deste projeto.

## Recursos

- Conexão WebSocket por conta (handshake, heartbeat, reconexão automática)
- **Adicionar e configurar contas pelo painel**, sem editar arquivos, com login por senha
- Proxy (SOCKS5/HTTP) individual por conta, com botão de testar
- Cooldown ao detectar login externo (close code `4001`)
- Detecção de token vencido/conta banida, com aviso no painel (o bot não fica reconectando à toa)
- Renovação automática do token da sessão
- Captura automática de Balls
- Reposição automática de Potions e Balls na loja
- Visão de inventário por conta
- Alertas no Discord (queda/volta, item raro, relatório diário)
- **Aba Mercado:** preços e média de 7 dias de todos os itens (com selo "barato"), vitrine de Pokémon com os filtros do jogo, histórico de vendas do servidor, anúncios e carteira de Gemas (somente leitura), calculadora de comissão, alertas no Discord e compra automática (sniper, desligada por padrão)
- Telemetria via FastAPI (`GET /api/telemetry`, `WS /ws/telemetry`) e dashboard React

## Requisitos

- Python 3.12+ (em Debian/Ubuntu, instale também `python3-venv`: `sudo apt install python3-venv`)
- Node 18+ (apenas para compilar o dashboard)
- Suas próprias contas do jogo

## Instalação

Guia completo, passo a passo (Windows, Linux/macOS, Android/Termux e VPS), com solução dos problemas
comuns: **[INSTALACAO.md](INSTALACAO.md)**.

Resumo rápido (precisa de Git, Python 3.12+ e, no Debian/Ubuntu, `python3-venv`; o Node 18+ é
opcional):

```bash
git clone https://github.com/DiuleJR/pokeidle-manager-online.git pokeidle
cd pokeidle
./iniciar.sh          # Windows: dois cliques em iniciar.bat
```

O script cria o ambiente, instala as dependências, compila o dashboard e inicia o bot.
Na **primeira vez**, abra `http://localhost:8080` e **crie uma senha** para o painel. Depois vá em
**Configurações → Adicionar conta**. Para atualizar depois:
`./iniciar.sh atualizar` (Windows: `.\iniciar.bat atualizar`).

## Adicionando uma conta

O jogo guarda a sessão no navegador. O painel precisa de três dados: **nick**,
**token** e **ID do dispositivo**. Você os copia do jogo em um clique:

1. No painel: **Configurações → Adicionar conta**.
2. Arraste o botão **"Copiar conta Pokeidle"** para a barra de favoritos do navegador
   (no computador). Ele é só um favorito com um pequeno código: roda na página do
   jogo, lê a sessão salva ali e copia os dados para a área de transferência. Nada
   é enviado a lugar nenhum; o código é visível no próprio painel.
3. Abra **pokeidle.io/app**, entre na conta e clique no favorito.
4. Volte ao painel, cole no campo e clique em **Testar e salvar**.

O painel conecta de verdade para validar e mostra o nick e o nível. Se o navegador
bloquear o favorito, use a aba **Console (F12)**: é uma linha para colar no console
do jogo. Há também a aba **Manual**.

> **Importante:** depois de adicionar, **feche a aba do jogo sem clicar em "Sair"**.
> Duas conexões da mesma conta se derrubam (login externo) e o bot entra em cooldown.

A sessão do jogo dura cerca de 30 dias; o bot guarda o token renovado sozinho. Se o
jogo deixar de aceitar o token, a conta aparece como **"Ação necessária"** e é só
reimportar em **Editar**.

### Proxy

Em **Adicionar conta** (ou **Editar**) marque "Usar proxy" e informe tipo, host,
porta e credenciais. O botão **Testar proxy** mostra o IP de saída. Sem proxy, a
conta conecta pelo IP da máquina. Confirme que o plano do proxy aceita várias
conexões simultâneas se várias contas usarem o mesmo.

## Acessando o painel numa VPS

O painel guarda tokens das suas contas, então proteja o acesso:

- **Túnel SSH (mais simples, nada a configurar no servidor):**
  `ssh -L 8080:localhost:8080 usuario@seu-servidor` e abra `http://localhost:8080`.
- **HTTPS com proxy reverso** (Caddy/nginx) se quiser acessar de qualquer lugar.
  Em HTTP puro fora do localhost a senha trafega sem criptografia (o painel avisa).

Por padrão o painel escuta só em `127.0.0.1`. Se mudar `TELEMETRY_HOST` para expor, o login
passa a ser exigido em tudo, e criar a senha de fora do computador do bot exige o **código de
configuração** mostrado no console (`journalctl -u pokeidle` na VPS).

### Rodando como serviço (systemd)

Veja [`deploy/pokeidle.service`](deploy/pokeidle.service). O `deploy.sh` é um exemplo
de atualização (git pull + build + restart) e exige `VPS=usuario@host`:

```bash
VPS=usuario@meu-servidor VPS_KEY=~/.ssh/minha_chave ./deploy.sh "mensagem"
```

### Docker (opcional)

```bash
docker compose up -d --build
docker compose logs        # código de configuração, se for criar a senha de fora
```

Os dados ficam em `./data` (monte como volume). Nunca faça commit dessa pasta.

## Migrando do `.env` antigo

Se você já tinha `ACC1_NICK`, `ACC1_TOKEN`, `ACC1_DEVICE_ID`, `ACC1_PROXY_*` etc., deixe
essas variáveis no `.env` e inicie: na primeira execução (banco vazio) elas são
importadas, junto com `WS_URL`, `DISCORD_WEBHOOK_URL`, `DAILY_REPORT_HOUR`,
`REPORT_TZ` e `PUBLIC_URL`. Depois disso o painel manda; você pode apagar essas
linhas do `.env`.

## Configurações do painel

Em **Configurações → Geral**: webhook do Discord (com botão de teste), hora em que o
dia vira e fuso do relatório, e a **URL pública** (opcional: só serve para mostrar o
ícone dos itens raros no Discord; quem roda na rede local deixa vazio).

## Mercado

A aba **Mercado** consulta o mercado do jogo pelas contas que estão online (somente leitura) e permite comprar.

- **Alertas:** avisam no Discord quando um item ou Pokémon aparece abaixo de um preço (ou X% abaixo da média).
- **Sniper (compra automática):** o jogo permite automação no mercado, e o sorteio entre quem compra junto
  mantém a disputa justa. Aqui ele nasce **desligado**: é preciso ligar a chave geral e cada regra exige
  preço máximo, conta e **orçamento diário** (o máximo que ela pode gastar por dia). Nunca compra de si mesmo.
- **Gemas valem dinheiro real.** O bot só **lê** a carteira. Ele nunca saca Gemas nem envia Coins; depósito e
  saque são feitos só dentro do jogo.
- Perder o sorteio da liberação não custa nada.

## Dados e segurança

- Contas e tokens ficam em `data/app.db` (SQLite, permissão restrita). Faça backup
  e **não publique** essa pasta.
- A API nunca devolve o token nem a senha de proxy (só os últimos caracteres).
- O painel pede uma senha, criada no primeiro acesso. Ela é guardada com hash (scrypt) e a sessão fica
  num cookie HttpOnly; há limite de tentativas erradas. Esqueceu a senha? Rode
  `python main.py --reset-password` no computador do bot e crie outra.

## Apoie o projeto

O projeto é gratuito e open source. Se ele te ajudou e você quiser retribuir, qualquer valor
ajuda a manter o desenvolvimento. Não é obrigatório e não libera nenhum recurso extra.

**Pix** (copia e cola, ou aponte a câmera do banco para o QR):

<img src="assets/pix-qr.png" alt="QR Code do Pix" width="200">

```text
00020126580014br.gov.bcb.pix0136d786a417-fce5-4167-9b5f-23614c67b6b25204000053039865802BR5912Diule Junior6009Sao Paulo62230519daqr7556502974044716304D7EB
```

**USDT (somente rede Solana)** — o mesmo tipo de saque do jogo:

```text
EEJYeV16B3Znwy31s66iYzRg6PninPDyLP9eQWnEDa8u
```

> Envie apenas USDT pela rede **Solana**. Tokens de outras redes enviados para esse
> endereço podem ser perdidos.

Outra forma de ajudar: deixar uma estrela no repositório, relatar bugs e compartilhar com quem joga.

## Licença

[GNU AGPL-3.0](LICENSE). Se você rodar uma versão modificada como serviço de rede,
precisa disponibilizar o código-fonte das modificações aos usuários.

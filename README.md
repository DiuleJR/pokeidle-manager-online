# pokeidle-manager

Bot headless em Python para gerenciar até 4 contas do jogo **pokeidle.io** ao mesmo
tempo, pensado para rodar em background numa VPS Linux (sem navegador), com um
dashboard web para acompanhar tudo.

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
- Cooldown ao detectar login externo (close code `4001`)
- Captura automática de Balls
- Reposição automática de Potions e Balls na loja
- Visão de inventário por conta
- Proxy (SOCKS5/HTTP) individual por conta
- Alertas no Discord (queda/volta, item raro, relatório diário)
- Telemetria via FastAPI (`GET /api/telemetry`, `WS /ws/telemetry`) e dashboard React

## Requisitos

- Python 3.12+
- Node 18+ (apenas para compilar o dashboard)
- Credenciais das suas próprias contas (nick, token e device ID)

## Configuração

```bash
cp .env.example .env
```

Edite o `.env`: `WS_URL`, as credenciais de cada conta (`ACC1_*` … `ACC4_*`) e,
se quiser, proxy, webhook do Discord e telemetria. Todas as opções estão
comentadas no `.env.example`.

**Nunca commite o `.env`.** Ele contém tokens das suas contas.

Se expuser a telemetria fora de `127.0.0.1` (Docker/VPS), defina `TELEMETRY_TOKEN`.

## Rodando

Local:

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Docker:

```bash
docker build -t pokeidle-manager .
docker run --env-file .env -p 8080:8080 pokeidle-manager
```

Dentro do container use `TELEMETRY_HOST=0.0.0.0` e defina `TELEMETRY_TOKEN`.

## Dashboard

```bash
cd web
npm install
npm run dev      # desenvolvimento (VITE_MOCK=1 usa dados falsos)
npm run build    # gera web/dist
```

O backend serve o build a partir de `web_dist/` (ou do caminho em `WEB_DIR`).

## Deploy em VPS

O `deploy.sh` é um exemplo (git pull + build + systemd). Ele exige a variável `VPS`:

```bash
VPS=usuario@meu-servidor VPS_KEY=~/.ssh/minha_chave ./deploy.sh "mensagem"
```

Adapte ao seu ambiente antes de usar.

## Licença

[GNU AGPL-3.0](LICENSE). Se você rodar uma versão modificada como serviço de rede,
precisa disponibilizar o código-fonte das modificações aos usuários.

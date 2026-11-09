# Instalação passo a passo

Este guia leva você do zero até o painel funcionando, no **Windows**, **Linux/macOS** ou
numa **VPS**. Se algo não funcionar, veja [Problemas comuns](#problemas-comuns) no final.

## Antes de começar

- **Use uma pasta nova.** Não reaproveite pastas ou arquivos `.env` de outras instalações:
  eles podem conter tokens de contas que já estão rodando em outro lugar.
- **A mesma conta não pode rodar em dois lugares ao mesmo tempo** (por exemplo, no seu PC
  e numa VPS). O jogo derruba uma das conexões (login externo).
- O jogo permite até **4 contas por pessoa**. O bot gerencia no máximo 4.

## Requisitos

| Programa | Versão | Para quê |
|---|---|---|
| Git | qualquer | baixar o projeto |
| Python | 3.12 ou mais novo | rodar o bot (no Windows, marque **"Add python.exe to PATH"** ao instalar) |
| Node.js | 18 ou mais novo | compilar o dashboard (só na instalação e nas atualizações) |

Confira no terminal; cada comando deve mostrar uma versão:

```
git --version
python --version
node --version
```

## Windows (PowerShell)

**1. Baixar o projeto**

```powershell
cd C:\
git clone https://github.com/DiuleJR/pokeidle-manager-online.git pokeidle
cd pokeidle
```

**2. Criar o ambiente Python e instalar as dependências**

```powershell
python -m venv venv
venv\Scripts\python -m pip install -r requirements.txt
```

**3. Compilar o dashboard** (leva 1 a 2 minutos)

```powershell
cd web
npm ci
npm run build
cd ..
Copy-Item web\dist web_dist -Recurse
```

**4. Iniciar**

```powershell
venv\Scripts\python main.py
```

Na primeira vez, o console mostra a linha **"CHAVE DO PAINEL"**. Copie e guarde essa chave.

**5. Abrir o painel**

Acesse `http://localhost:8080`, cole a chave e siga para [Adicionar sua primeira conta](#adicionar-sua-primeira-conta).

## Linux / macOS

```bash
git clone https://github.com/DiuleJR/pokeidle-manager-online.git pokeidle
cd pokeidle

python3 -m venv venv
venv/bin/python -m pip install -r requirements.txt

cd web && npm ci && npm run build && cd ..
mkdir -p web_dist && cp -r web/dist/. web_dist/

venv/bin/python main.py
```

Depois, abra `http://localhost:8080` e use a chave mostrada no console.

## Adicionar sua primeira conta

1. No painel, abra a aba **Configurações** e clique em **Adicionar conta**.
2. Na aba **Bookmarklet (1 clique)**, arraste o botão **"⭐ Copiar conta Pokeidle"** para a
   barra de favoritos do navegador (no PC). Se a barra estiver escondida, mostre-a com
   `Ctrl+Shift+B`. Se não conseguir arrastar, use "copiar o endereço" e crie um favorito
   colando o texto em "URL".
3. Abra `pokeidle.io/app` no mesmo navegador, entre na conta e **clique no favorito**.
   Deve aparecer o aviso "Conta … copiada!". (Se o navegador bloquear o favorito, use a aba
   **Console (F12)** do painel.)
4. Volte ao painel, cole no campo e clique em **Testar e salvar**.
5. **Feche a aba do jogo sem clicar em "Sair".** Duas conexões da mesma conta se derrubam.

A sessão do jogo dura cerca de 30 dias; o bot guarda o token renovado sozinho. Se a conta
aparecer como **"Ação necessária"**, abra **Editar → Reimportar token** e repita o passo 3.

## Usar no dia a dia

| Quero… | Faça |
|---|---|
| Parar o bot | `Ctrl+C` no console |
| Iniciar de novo | na pasta do projeto: `venv\Scripts\python main.py` (Windows) ou `venv/bin/python main.py` (Linux/macOS) |
| Atualizar o projeto | `git pull`; se algo em `web/` mudou, refaça o passo de compilar o dashboard |
| Fazer backup | copie a pasta `data/` (o arquivo `app.db` guarda as contas e os tokens) |

As contas ficam salvas em `data/app.db`. **Não publique nem compartilhe essa pasta.**

## Deixar rodando o tempo todo

- **No PC:** o bot só roda enquanto a janela estiver aberta. Para não fechar sem querer,
  minimize a janela ou use o Agendador de Tarefas do Windows.
- **Numa VPS Linux** (recomendado para 24 horas por dia): instale como no bloco Linux acima
  e use o serviço systemd de exemplo em [`deploy/pokeidle.service`](deploy/pokeidle.service):

  ```bash
  sudo cp deploy/pokeidle.service /etc/systemd/system/pokeidle.service
  # ajuste User, WorkingDirectory e ExecStart se sua pasta for outra
  sudo systemctl daemon-reload
  sudo systemctl enable --now pokeidle
  journalctl -u pokeidle -f        # a chave do painel aparece aqui na primeira vez
  ```

  Para abrir o painel de fora da VPS, **não exponha a porta direto em HTTP**: use um túnel SSH
  (`ssh -L 8080:localhost:8080 usuario@seu-servidor`) ou HTTPS. Veja o [README](README.md).

## Docker (opcional, ainda não testado)

```bash
docker compose up -d --build
docker compose logs          # chave do painel na primeira execução
```

Os dados ficam em `./data`. O caminho com Python direto, descrito acima, é o recomendado.

## Problemas comuns

**Perdi a chave do painel.** Crie um arquivo `.env` na pasta do projeto com a linha
`TELEMETRY_TOKEN=uma-chave-que-voce-escolher` e reinicie. Esse valor passa a valer.

**A porta 8080 já está em uso.** No mesmo `.env`, coloque `TELEMETRY_PORT=8081` (ou outro número).

**`python` não é reconhecido (Windows).** Reinstale o Python marcando "Add python.exe to PATH",
ou use `py -3` no lugar de `python`.

**`npm` não é reconhecido.** Instale o Node.js e abra um terminal novo.

**A conta fica "Pausada" com "login externo".** Alguém usa a conta em outro lugar (jogo aberto
no navegador, app no celular ou outro bot). Feche essa sessão; o bot tenta de novo a cada
5 minutos.

**"Provedor de rede banido pelo jogo" ao usar proxy.** O jogo recusa o provedor desse proxy
(comum em proxies de datacenter). Remova o proxy da conta ou use outro, de preferência
residencial.

**O painel mostra versão antiga depois de atualizar.** Feche e abra a aba; o painel guarda uma
cópia em cache.

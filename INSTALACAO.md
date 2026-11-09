# Instalação passo a passo

Este guia leva você do zero até o painel funcionando, no **Windows**, no **Linux/macOS** ou
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
| Git | qualquer | baixar e atualizar o projeto |
| Python | 3.12 ou mais novo | rodar o bot (no Windows, marque **"Add python.exe to PATH"** ao instalar) |
| python3-venv | — | **só Debian/Ubuntu** (inclusive VPS): pacote que permite criar o ambiente do bot. Instale com `sudo apt install python3-venv` |
| Node.js | 18 ou mais novo | compilar o dashboard (só na instalação e nas atualizações). **Opcional:** sem o Node, o script baixa o dashboard já compilado da página de Releases do projeto |

Confira no terminal (PowerShell no Windows); cada comando deve mostrar uma versão:

```
git --version
python --version        # no Linux/macOS: python3 --version
node --version
```

## Instalação rápida (recomendada)

Um script faz tudo: cria o ambiente, instala as dependências, compila o dashboard e inicia o
bot. Na primeira vez leva alguns minutos; depois inicia na hora.

### Windows

1. Baixe o projeto (PowerShell):

   ```powershell
   cd C:\
   git clone https://github.com/DiuleJR/pokeidle-manager-online.git pokeidle
   ```

2. Abra a pasta `C:\pokeidle` e dê **dois cliques em `iniciar.bat`**.

### Linux / macOS

```bash
git clone https://github.com/DiuleJR/pokeidle-manager-online.git pokeidle
cd pokeidle
./iniciar.sh
```

### O que acontece em seguida

Na **primeira vez**, abra `http://localhost:8080` e **crie uma senha** para o painel (mínimo de 8
caracteres). Depois siga para
[Adicionar sua primeira conta](#adicionar-sua-primeira-conta).

## Instalação manual (passo a passo, sem o script)

Faz exatamente o mesmo que o script, passo a passo. Útil para entender o que acontece ou se
o script falhar.

### Windows (PowerShell)

```powershell
cd C:\
git clone https://github.com/DiuleJR/pokeidle-manager-online.git pokeidle
cd pokeidle

python -m venv venv
venv\Scripts\python -m pip install -r requirements.txt

cd web
npm ci
npm run build
cd ..
Copy-Item web\dist web_dist -Recurse

venv\Scripts\python main.py
```

### Linux / macOS

```bash
git clone https://github.com/DiuleJR/pokeidle-manager-online.git pokeidle
cd pokeidle

python3 -m venv venv
venv/bin/python -m pip install -r requirements.txt

cd web && npm ci && npm run build && cd ..
mkdir -p web_dist && cp -r web/dist/. web_dist/

venv/bin/python main.py
```

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

| Quero… | Windows | Linux / macOS |
|---|---|---|
| Iniciar | dois cliques em `iniciar.bat` | `./iniciar.sh` |
| Parar | feche a janela ou `Ctrl+C` | `Ctrl+C` |
| Atualizar o projeto | no PowerShell, na pasta: `.\iniciar.bat atualizar` | `./iniciar.sh atualizar` |
| Fazer backup | copie a pasta `data\` | copie a pasta `data/` |

O comando de atualizar baixa a versão nova (`git pull`) e recompila o dashboard. As contas
ficam salvas em `data/app.db`: **não publique nem compartilhe essa pasta**, ela guarda os
tokens.

## Deixar rodando o tempo todo

- **No PC:** o bot só roda enquanto a janela estiver aberta e o computador ligado. Minimize a
  janela para não fechá-la sem querer. Para iniciar junto com o Windows, use o Agendador de
  Tarefas apontando para o `iniciar.bat`.
- **Numa VPS Linux** (recomendado para 24 horas por dia): instale como no bloco Linux acima
  (o `./iniciar.sh` serve para a primeira vez; em Debian/Ubuntu rode antes
  `sudo apt install -y git python3-venv`, e use a pasta `/opt/pokeidle`) e use o serviço
  systemd de exemplo em [`deploy/pokeidle.service`](deploy/pokeidle.service). Ele roda como o
  usuário `pokeidle`, que precisa existir e ser dono da pasta:

  ```bash
  sudo useradd --system --home /opt/pokeidle --shell /usr/sbin/nologin pokeidle
  sudo chown -R pokeidle:pokeidle /opt/pokeidle
  sudo cp deploy/pokeidle.service /etc/systemd/system/pokeidle.service
  # ajuste User, WorkingDirectory e ExecStart se sua pasta for outra
  sudo systemctl daemon-reload
  sudo systemctl enable --now pokeidle
  journalctl -u pokeidle -f        # se for criar a senha de fora da VPS, o código de configuração aparece aqui
  ```

  Para abrir o painel de fora da VPS, **não exponha a porta direto em HTTP**: use um túnel SSH
  (`ssh -L 8080:localhost:8080 usuario@seu-servidor`) ou HTTPS. Veja o [README](README.md).

## Android (Termux)

Testado em um celular Android com o Termux mais recente: instala, abre o painel e conecta a
conta normalmente. A conta sai pelo IP do próprio celular.

1. Instale o **Termux pelo F-Droid** (a versão da Play Store está desatualizada).
2. Instale os programas (o `rust` e o `clang` são necessários para compilar algumas
   bibliotecas Python):

   ```bash
   pkg update && pkg upgrade
   pkg install python git clang make rust binutils libffi openssl tmux
   ```

3. Baixe e inicie (a primeira vez demora, por causa da compilação):

   ```bash
   git clone https://github.com/DiuleJR/pokeidle-manager-online.git pokeidle
   cd pokeidle
   ./iniciar.sh
   ```

4. Abra `http://localhost:8080` no navegador do celular e crie a senha.
5. **Adicionar conta:** no celular não há F12, então pegue o token no computador (bookmarklet
   ou snippet do console, como em [Adicionar sua primeira conta](#adicionar-sua-primeira-conta)),
   envie o texto copiado para o celular (por exemplo, por uma mensagem para você mesmo) e cole
   no painel.

Para o bot não parar em segundo plano (estas dicas **ainda não foram testadas**; o restante
acima foi):

- Rode dentro do `tmux` (digite `tmux`, depois `./iniciar.sh`).
- Use `termux-wake-lock` (ou "Adquirir wake lock" na notificação do Termux).
- Tire o Termux da otimização de bateria nas configurações do Android.

Cuidados: não rode as mesmas contas no celular e em outro lugar ao mesmo tempo (o jogo derruba
uma das conexões), e lembre que 4 conexões abertas o tempo todo gastam bateria e dados. Para
rodar 24 horas por dia, a VPS continua sendo a melhor opção.

## Docker (opcional, ainda não testado)

```bash
docker compose up -d --build
docker compose logs          # código de configuração, se for criar a senha de fora
```

Os dados ficam em `./data`. O caminho com Python direto, descrito acima, é o recomendado.

## Problemas comuns

**Esqueci a senha do painel.** No computador onde o bot roda, na pasta do projeto, rode
`venv\Scripts\python main.py --reset-password` (Windows) ou `venv/bin/python main.py --reset-password`
(Linux/macOS) e abra o painel para criar uma senha nova. As contas continuam salvas.

**Quero criar a senha de outro computador (por exemplo, o painel numa VPS).** O painel pede o
**código de configuração**, que aparece no console do bot (na VPS: `journalctl -u pokeidle`).

**A porta 8080 já está em uso.** No mesmo `.env`, coloque `TELEMETRY_PORT=8081` (ou outro número).

**O `iniciar.bat` fecha rápido demais / mostra erro.** Abra o PowerShell na pasta e rode
`.\iniciar.bat` para ler a mensagem. As causas mais comuns são Python ou Node não instalados
(veja os [Requisitos](#requisitos)).

**`python` não é reconhecido (Windows).** Reinstale o Python marcando "Add python.exe to PATH".
O `iniciar.bat` também reconhece o comando `py`.

**`npm` não é reconhecido.** Sem o Node.js, o `iniciar.bat`/`iniciar.sh` tenta baixar o
dashboard já compilado da última Release. Se isso falhar (sem Release publicada ou sem
internet), instale o Node.js, abra um terminal novo e rode o script de novo.

**Linux: "ensurepip is not available" ao criar o ambiente.** Instale o pacote do venv:
`sudo apt install python3-venv`.

**A conta fica "Pausada" com "login externo".** Alguém usa a conta em outro lugar (jogo aberto
no navegador, app no celular ou outro bot). Feche essa sessão; o bot tenta de novo a cada
5 minutos.

**"Provedor de rede banido pelo jogo" ao usar proxy.** O jogo recusa o provedor desse proxy
(comum em proxies de datacenter). Remova o proxy da conta ou use outro, de preferência
residencial.

**O painel mostra versão antiga depois de atualizar.** Feche e abra a aba; o painel guarda uma
cópia em cache.

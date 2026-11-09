#!/usr/bin/env bash
# Deploy: envia o código ao GitHub, compila o dashboard aqui, atualiza a VPS e reinicia o bot.
# Uso (Git Bash, na raiz do projeto):  ./deploy.sh ["mensagem do commit"]
set -euo pipefail
cd "$(dirname "$0")"

# Defina VPS (ex.: usuario@meu-servidor) e, opcionalmente, VPS_KEY (chave SSH).
VPS="${VPS:?defina VPS=usuario@host}"
KEY="${VPS_KEY:-$HOME/.ssh/id_ed25519}"
DIR="/opt/pokeidle"
SSH="ssh -i $KEY -o BatchMode=yes $VPS"

# 1) Commit (se houver mudanças) e push
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "${1:-Atualização}"
fi
git push -q origin main
echo "✔ GitHub atualizado ($(git rev-parse --short HEAD))"

# 2) Build do dashboard (a VPS tem pouca RAM: compila aqui)
# VITE_MOCK vazio: o .env.local de desenvolvimento (dados falsos) nunca pode entrar no build publicado.
(cd web && VITE_MOCK= npm run build --silent)
echo "✔ Build do dashboard pronto"

# 3) VPS: puxa o código, instala dependências se mudaram, envia o dist e reinicia
$SSH "cd $DIR && git pull -q --ff-only && venv/bin/pip install -q -r requirements.txt"
$SSH "rm -rf $DIR/web_dist && mkdir -p $DIR/web_dist"
tar cf - -C web/dist . | $SSH "tar xf - -C $DIR/web_dist"
$SSH "systemctl restart pokeidle"
echo "✔ VPS atualizada e bot reiniciado"

# 4) Confere
sleep 15
$SSH "systemctl is-active pokeidle; journalctl -u pokeidle --since '-20s' --no-pager | grep -cE 'ONLINE|morreu' | sed 's/^/eventos no log: /'"

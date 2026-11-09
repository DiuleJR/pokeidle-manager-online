#!/usr/bin/env bash
# Uso: ./iniciar.sh            instala (na 1a vez) e inicia o bot e o painel
#      ./iniciar.sh atualizar  baixa a versao nova do projeto antes de iniciar
set -euo pipefail
cd "$(dirname "$0")"

erro() { echo; echo "[erro] $*" >&2; exit 1; }

PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null 2>&1 || erro "Python nao encontrado. Instale o Python 3.12 ou mais novo (Debian/Ubuntu: sudo apt install python3 python3-venv)."
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' \
  || erro "E preciso o Python 3.12 ou mais novo (encontrado: $("$PY" --version 2>&1)). Use PYTHON=python3.12 ./iniciar.sh se tiver outra versao instalada."

if [ "${1:-}" = "atualizar" ]; then
  command -v git >/dev/null 2>&1 || erro "O Git nao foi encontrado."
  echo "Baixando a versao nova..."
  git pull --ff-only
  rm -rf web_dist
fi

if [ ! -x venv/bin/python ]; then
  echo "Criando o ambiente Python (so na primeira vez)..."
  "$PY" -m venv venv || erro "Nao consegui criar o ambiente. No Debian/Ubuntu instale: sudo apt install python3-venv"
fi

echo "Verificando as dependencias do bot..."
venv/bin/python -m pip install -q -r requirements.txt

if [ ! -f web_dist/index.html ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "Compilando o dashboard (leva de 1 a 2 minutos)..."
    (cd web && npm ci --silent && npm run build --silent)
    rm -rf web_dist && mkdir -p web_dist && cp -r web/dist/. web_dist/
  else
    echo
    echo "O Node.js nao esta instalado: tentando baixar o dashboard ja compilado..."
    if ! venv/bin/python scripts/get_dashboard.py; then
      echo
      echo "[aviso] Nao consegui obter o dashboard. Instale o Node.js 18 ou mais novo (https://nodejs.org)"
      echo "        e rode este script de novo. O bot vai iniciar mesmo assim, mas sem a tela do painel."
      echo
    fi
  fi
fi

echo
echo "Iniciando. Abra http://localhost:8080 no navegador."
echo "Na primeira vez, o painel pede para voce criar uma senha."
echo "Para parar, aperte Ctrl+C."
echo
# O bot sai com o código 75 depois de se atualizar pelo painel: aqui ele sobe de novo.
export POKEIDLE_SUPERVISED=1
while true; do
  code=0
  venv/bin/python -u main.py || code=$?
  [ "$code" -eq 75 ] || exit "$code"
  echo
  echo "Reiniciando com a versao nova..."
  echo
  venv/bin/python -m pip install -q -r requirements.txt || true
done

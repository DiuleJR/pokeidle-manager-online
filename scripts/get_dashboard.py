"""Baixa o dashboard já compilado (web_dist.zip) da última Release do GitHub e extrai em web_dist/.

Usado pelo iniciar.bat / iniciar.sh quando o Node.js não está instalado. Quem tem Node compila o
dashboard direto do código-fonte (web/), então este script é opcional.

Uso: python scripts/get_dashboard.py [URL_DO_ZIP]
"""
from __future__ import annotations

import io
import os
import shutil
import sys
import urllib.request
import zipfile

REPO = "DiuleJR/pokeidle-manager-online"
DEFAULT_URL = f"https://github.com/{REPO}/releases/latest/download/web_dist.zip"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def install(data: bytes, dest: str) -> None:
    """Extrai o zip em `dest` (substituindo o conteúdo). Recusa caminhos fora da pasta (zip-slip)
    e zips sem index.html."""
    tmp = dest + ".novo"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    base = os.path.realpath(tmp)
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for name in z.namelist():
                target = os.path.realpath(os.path.join(tmp, name))
                if target != base and not target.startswith(base + os.sep):
                    raise ValueError(f"arquivo com caminho inválido no zip: {name}")
            z.extractall(tmp)
        if not os.path.isfile(os.path.join(tmp, "index.html")):
            raise ValueError("o zip não contém index.html (não parece ser o dashboard)")
        shutil.rmtree(dest, ignore_errors=True)
        os.replace(tmp, dest)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    print(f"Baixando o dashboard pronto: {url}")
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
        install(data, os.path.join(ROOT, "web_dist"))
    except Exception as e:  # noqa: BLE001 - qualquer falha vira uma mensagem clara
        print(f"[aviso] Não consegui baixar o dashboard: {e}", file=sys.stderr)
        return 1
    print("Dashboard instalado em web_dist/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Gera o app do Windows: dist/PokeIdleManager/PokeIdleManager.exe (PyInstaller).

Uso (no Windows, com o dashboard já compilado em web/dist):
    pip install -r requirements.txt pyinstaller pystray pillow
    python scripts/build_windows.py

O instalador (deploy/windows/installer.iss, Inno Setup) empacota essa pasta.
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> None:
    import PyInstaller.__main__ as pyi

    dist = os.path.join(ROOT, "web", "dist")
    if not os.path.isfile(os.path.join(dist, "index.html")):
        sys.exit("Compile o dashboard antes: cd web && npm ci && npm run build")
    os.chdir(ROOT)
    extra = ["--distpath", sys.argv[1]] if len(sys.argv) > 1 else []     # ex.: outra pasta se o app estiver aberto
    pyi.run([*extra,
        "desktop.py", "--name", "PokeIdleManager", "--noconfirm", "--clean", "--windowed",
        "--icon", os.path.join("web", "public", "favicon.ico"),
        "--add-data", f"{dist}{os.pathsep}web_dist",
        "--collect-all", "webview", "--collect-all", "tzdata",
        "--hidden-import", "uvicorn.logging", "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols.http.auto", "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan.on", "--hidden-import", "pystray._win32",
        "--exclude-module", "tkinter",
    ])


if __name__ == "__main__":
    main()

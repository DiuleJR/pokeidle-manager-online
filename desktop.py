"""App do Windows (PokeIdleManager.exe): o mesmo bot e painel, sem precisar instalar Python, Git ou Node.

- Dados (contas, tokens, estatísticas) ficam em %LOCALAPPDATA%\\PokeIdleManager, fora da pasta do
  programa: atualizar ou reinstalar não apaga nada.
- Ícone na bandeja do sistema: abrir o painel, sair.
- Abrir o programa de novo com ele já rodando só abre o painel no navegador.
- `--login-window`: o próprio executável abre a janela de login do jogo (ver login_window.py).

Também roda direto do código (`python desktop.py`), útil para testar.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import webbrowser

APP_NAME = "PokeIdleManager"
FROZEN = bool(getattr(sys, "frozen", False))


def bundle_dir() -> str:
    """Pasta com o dashboard compilado: dentro do executável, ou ao lado do código."""
    return getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))


def app_home() -> str:
    base = os.getenv("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    return os.path.join(base, APP_NAME)


def setup_environment() -> str:
    """Aponta dados, estado e dashboard para os lugares certos. Devolve a pasta do app."""
    home = app_home()
    os.makedirs(os.path.join(home, "data"), exist_ok=True)
    os.environ.setdefault("DATA_DIR", os.path.join(home, "data"))
    os.environ.setdefault("DAILY_FILE", os.path.join(home, "daily_state.json"))
    os.environ.setdefault("SESSION_FILE", os.path.join(home, "session_state.json"))
    os.environ.setdefault("WEB_DIR", os.path.join(bundle_dir(), "web_dist"))
    os.environ["POKEIDLE_DESKTOP"] = "1"
    if sys.stdout is None or sys.stderr is None:       # sem console (executável "janelado"): vai para arquivo
        log = open(os.path.join(home, "bot.log"), "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log
    return home


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def start_tray(url: str) -> None:
    """Ícone na bandeja. Sem pystray/Pillow (ou sem bandeja) o bot segue funcionando normalmente."""
    try:
        import pystray
        from PIL import Image
    except ImportError:
        return
    icon_path = os.path.join(bundle_dir(), "web_dist", "icon-192.png")
    try:
        image = Image.open(icon_path)
    except OSError:
        image = Image.new("RGBA", (64, 64), (230, 190, 70, 255))

    def quit_app(icon, _item) -> None:
        icon.stop()
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem("Abrir o painel", lambda *_: webbrowser.open(url), default=True),
        pystray.MenuItem("Sair", quit_app),
    )
    tray = pystray.Icon(APP_NAME, image, "PokeIdle Manager", menu)
    threading.Thread(target=tray.run, daemon=True).start()


def main() -> None:
    if "--login-window" in sys.argv:
        import login_window
        sys.exit(login_window.main())
    setup_environment()
    port = int(os.getenv("TELEMETRY_PORT", "8080"))
    url = f"http://localhost:{port}"
    if port_in_use(port):               # já está rodando: só abre o painel
        webbrowser.open(url)
        return
    start_tray(url)
    if not os.getenv("POKEIDLE_NO_BROWSER"):
        threading.Timer(2.5, webbrowser.open, args=(url,)).start()
    import main as bot
    bot.main()


if __name__ == "__main__":
    main()

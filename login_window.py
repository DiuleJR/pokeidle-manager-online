"""Janela de login do jogo: abre o pokeidle.io num navegador embutido e devolve o token.

Roda como PROCESSO À PARTE (`python login_window.py`, ou `PokeIdleManager.exe --login-window`
no executável). O painel dispara esse processo, o usuário entra na conta como faria no
navegador e, assim que o jogo grava a sessão, a janela fecha sozinha e imprime uma linha
JSON em stdout: {"nick": ..., "token": ..., "dispositivo": ...}.

Saída: 0 = sessão lida, 2 = janela fechada sem login, 3 = navegador embutido indisponível.
A janela é privada (sem cookies de antes), então cada login começa do zero e não mistura
contas. Ela não tenta ligar o jogo: lê a sessão e fecha em seguida.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import threading
import time

GAME_URL = "https://pokeidle.io/app"
WIN_W, WIN_H = 480, 760
POLL_S = 0.8
READ_JS = ("JSON.stringify({s: localStorage.getItem('sessao'),"
           " d: localStorage.getItem('id-dispositivo')})")

EXIT_OK, EXIT_CLOSED, EXIT_UNAVAILABLE = 0, 2, 3


def available() -> bool:
    """O navegador embutido (pywebview) está instalado e há tela para abrir a janela?"""
    if importlib.util.find_spec("webview") is None:
        return False
    if sys.platform.startswith("linux"):
        import os
        return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
    return True


def parse_session(raw: str | None) -> dict | None:
    """Converte o que READ_JS devolveu em {nick, token, dispositivo}; None se ainda não logou."""
    try:
        data = json.loads(raw or "")
        sess = json.loads(data.get("s") or "null")
    except (ValueError, TypeError, AttributeError):
        return None
    if not isinstance(sess, dict):
        return None
    nick, token = str(sess.get("nick") or "").strip(), str(sess.get("token") or "").strip()
    if not nick or not token:
        return None
    return {"nick": nick, "token": token, "dispositivo": str(data.get("d") or "").strip()}


class LoginError(Exception):
    """Falha ao obter a sessão; `reason` é 'closed', 'timeout' ou 'unavailable'."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _command() -> list[str]:
    if getattr(sys, "frozen", False):              # executável: ele mesmo abre a janela
        return [sys.executable, "--login-window"]
    from pathlib import Path
    return [sys.executable, str(Path(__file__).resolve())]


def _out_arg(argv: list[str]) -> str | None:
    """Caminho do arquivo de saída (`--out`): o executável sem console não tem stdout confiável."""
    return argv[argv.index("--out") + 1] if "--out" in argv and argv.index("--out") + 1 < len(argv) else None


def centered_origin(cx: float, cy: float, dpr: float) -> tuple[int, int]:
    """Canto da janela de login para que ela fique centrada no ponto (cx, cy) do painel.
    cx/cy vêm do navegador em pixels CSS; a janela nativa usa pixels da tela (× dpr)."""
    dpr = dpr if 0.5 <= dpr <= 4 else 1.0
    return max(0, round((cx - WIN_W / 2) * dpr)), max(0, round((cy - WIN_H / 2) * dpr))


async def run(timeout: float = 300.0, center: tuple[float, float, float] | None = None) -> dict:
    """Abre a janela de login e devolve {nick, token, dispositivo}. Levanta LoginError.
    `center` = (cx, cy, dpr): ponto do painel sobre o qual a janela abre centralizada."""
    import asyncio
    import os
    import tempfile
    if not available():
        raise LoginError("unavailable")
    fd, out_path = tempfile.mkstemp(prefix="pokeidle-login-", suffix=".json")
    os.close(fd)
    proc = await asyncio.create_subprocess_exec(
        *_command(), "--out", out_path,
        *(["--at", *(f"{v:.2f}" for v in center)] if center else []), stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    try:
        try:
            await asyncio.wait_for(proc.wait(), timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise LoginError("timeout") from None
        except asyncio.CancelledError:
            proc.kill()
            raise
        if proc.returncode == EXIT_OK:
            try:
                with open(out_path, encoding="utf-8") as f:
                    found = json.load(f)
            except (OSError, ValueError):
                found = None
            if isinstance(found, dict) and found.get("nick") and found.get("token"):
                return found
            raise LoginError("closed")
        raise LoginError("unavailable" if proc.returncode == EXIT_UNAVAILABLE else "closed")
    finally:                                         # o arquivo tem o token: nunca fica no disco
        try:
            os.remove(out_path)
        except OSError:
            pass


def main() -> int:
    try:
        import webview
    except ImportError:
        print("pywebview não instalado", file=sys.stderr)
        return EXIT_UNAVAILABLE

    result: dict = {}
    pos: dict = {}
    argv = sys.argv[1:]
    if "--at" in argv:
        try:
            cx, cy, dpr = (float(v) for v in argv[argv.index("--at") + 1:argv.index("--at") + 4])
            pos["x"], pos["y"] = centered_origin(cx, cy, dpr)
        except (ValueError, IndexError):
            pos = {}
    window = webview.create_window("Entrar no PokeIdle", GAME_URL, width=WIN_W, height=WIN_H,
                                   min_size=(360, 560), on_top=True, **pos)   # sempre à frente do navegador

    def watch() -> None:
        while True:
            time.sleep(POLL_S)
            try:
                found = parse_session(window.evaluate_js(READ_JS))
            except Exception:           # janela fechando ou página ainda carregando
                continue
            if found:
                result.update(found)
                window.destroy()
                return

    threading.Thread(target=watch, daemon=True).start()
    try:
        webview.start(private_mode=True)
    except Exception as e:              # sem WebView2/GTK/WebKit
        print(f"navegador embutido indisponível: {e}", file=sys.stderr)
        return EXIT_UNAVAILABLE
    if not result:
        return EXIT_CLOSED
    out = _out_arg(sys.argv[1:])
    if out:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(result, f)
    else:
        print(json.dumps(result), flush=True)
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())

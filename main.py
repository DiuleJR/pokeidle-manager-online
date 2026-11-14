"""Runner principal: gerenciador de contas + servidor do painel (FastAPI),
tudo no mesmo event loop.

Contas e configurações ficam no banco (data/app.db) e são editadas pelo painel.
Na 1ª execução, contas ACC1..ACC4 do .env (formato antigo) são importadas.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys

import uvicorn
from dotenv import load_dotenv

import notify
from auth import Auth
from manager import AccountManager
from notify import DailyStats, Notifier
from store import Store
from telemetry import create_app
from updater import Updater

log = logging.getLogger("main")

LOOPBACK = ("127.0.0.1", "localhost", "::1")


async def amain() -> None:
    desktop = os.getenv("POKEIDLE_DESKTOP") == "1"
    # App do Windows: configuração só da própria pasta de dados; nunca puxa o .env de outro projeto.
    load_dotenv(os.path.join(os.path.dirname(os.getenv("DATA_DIR", "")), ".env") if desktop else None)
    if desktop:                         # Tailscale e rede local chegam pelo IP do PC: escuta em todas as interfaces
        os.environ.setdefault("TELEMETRY_HOST", "0.0.0.0")      # mude em %LOCALAPPDATA%\PokeIdleManager\.env
    store = Store()
    if not desktop:
        store.import_env_once()

    host = os.getenv("TELEMETRY_HOST", "127.0.0.1")
    port = int(os.getenv("TELEMETRY_PORT", "8080"))
    interval = float(os.getenv("TELEMETRY_INTERVAL_S", "1"))
    origins = [o.strip() for o in os.getenv("TELEMETRY_CORS_ORIGINS", "").split(",") if o.strip()]
    exposed = host not in LOOPBACK
    auth = Auth(store, exposed=exposed, desktop=desktop)

    notifier = Notifier(store.get_setting("discord_webhook"))
    daily = DailyStats(report_hour=int(store.get_setting("report_hour") or 0),
                       tz_name=store.get_setting("report_tz"))
    notify.set_public_url(store.get_setting("public_url"))
    log.info("Webhook Discord: %s", "ligado" if notifier.enabled else "desligado")
    manager = AccountManager(store, notifier, daily)
    updater = Updater()

    app = create_app(manager.connections, auth, interval=interval, cors_origins=origins,
                     manager=manager, store=store, updater=updater)
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="warning"))
    server.install_signal_handlers = lambda: None  # o asyncio.run/KeyboardInterrupt cuida

    shown = "localhost" if host in LOOPBACK else host
    log.info("Painel em http://%s:%d", shown, port)
    if exposed:
        log.warning("Painel exposto em %s. Acesse por HTTPS ou túnel SSH: a senha trafega em texto puro em HTTP.", host)
    if auth.mode == "setup":
        log.info("Primeiro acesso: abra o painel e crie sua senha.")
        if exposed:
            log.warning("=" * 60)
            log.warning("CÓDIGO DE CONFIGURAÇÃO (peça ao criar a senha de fora deste computador): %s",
                        auth.setup_code())
            log.warning("=" * 60)
        else:
            log.info("Se for criar a senha de outro computador, o código de configuração é: %s", auth.setup_code())

    # Falha de uma conta nunca derruba as outras (run_forever captura erros).
    await asyncio.gather(server.serve(), notifier.run(), daily.run(notifier), manager.run(), updater.run())


def reset_password() -> None:
    """Esqueci a senha: roda na máquina do bot, apaga a senha e encerra as sessões."""
    load_dotenv()
    Auth(Store()).reset()
    print("Senha removida e sessões encerradas. Abra o painel para criar uma nova senha.")


def main() -> None:
    if "--login-window" in sys.argv:        # o executável reaproveita a si mesmo para abrir a janela
        import login_window
        sys.exit(login_window.main())
    if "--reset-password" in sys.argv:
        reset_password()
        return
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)-5s %(message)s",
                        datefmt="%H:%M:%S")
    logging.getLogger("websockets").setLevel(logging.WARNING)
    try:
        asyncio.run(amain())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

"""Runner principal: gerenciador de contas + servidor do painel (FastAPI),
tudo no mesmo event loop.

Contas e configurações ficam no banco (data/app.db) e são editadas pelo painel.
Na 1ª execução, contas ACC1..ACC4 do .env (formato antigo) são importadas.
"""
from __future__ import annotations

import asyncio
import logging
import os

import uvicorn
from dotenv import load_dotenv

import notify
from manager import AccountManager
from notify import DailyStats, Notifier
from store import Store
from telemetry import create_app

log = logging.getLogger("main")

LOOPBACK = ("127.0.0.1", "localhost", "::1")


async def amain() -> None:
    load_dotenv()
    store = Store()
    store.import_env_once()
    admin_key = store.admin_key()

    host = os.getenv("TELEMETRY_HOST", "127.0.0.1")
    port = int(os.getenv("TELEMETRY_PORT", "8080"))
    interval = float(os.getenv("TELEMETRY_INTERVAL_S", "1"))
    origins = [o.strip() for o in os.getenv("TELEMETRY_CORS_ORIGINS", "").split(",") if o.strip()]
    exposed = host not in LOOPBACK
    # Escuta só local: leitura do dashboard sem senha (a gestão sempre exige a chave).
    # Exposto na rede/internet: tudo exige a chave.
    read_token = os.getenv("TELEMETRY_TOKEN", "").strip() or (admin_key if exposed else "")

    notifier = Notifier(store.get_setting("discord_webhook"))
    daily = DailyStats(report_hour=int(store.get_setting("report_hour") or 0),
                       tz_name=store.get_setting("report_tz"))
    notify.set_public_url(store.get_setting("public_url"))
    log.info("Webhook Discord: %s", "ligado" if notifier.enabled else "desligado")
    manager = AccountManager(store, notifier, daily)

    app = create_app(manager.connections, token=read_token, interval=interval, cors_origins=origins,
                     manager=manager, store=store, admin_key=admin_key)
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="warning"))
    server.install_signal_handlers = lambda: None  # o asyncio.run/KeyboardInterrupt cuida

    shown = "localhost" if host in LOOPBACK else host
    log.info("Painel em http://%s:%d", shown, port)
    if exposed and not os.getenv("TELEMETRY_TOKEN", "").strip():
        log.warning("Painel exposto em %s. Acesse por HTTPS ou túnel SSH: a chave trafega em texto puro em HTTP.", host)
    if store.generated_key_now:
        log.warning("=" * 60)
        log.warning("CHAVE DO PAINEL (gerada agora; guarde): %s", admin_key)
        log.warning("Ela é pedida ao abrir o painel. Para mudar, defina TELEMETRY_TOKEN.")
        log.warning("=" * 60)

    # Falha de uma conta nunca derruba as outras (run_forever captura erros).
    await asyncio.gather(server.serve(), notifier.run(), daily.run(notifier), manager.run())


def main() -> None:
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

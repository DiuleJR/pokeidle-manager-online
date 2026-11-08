"""Runner principal: uma conexão por conta + servidor de telemetria (FastAPI),
tudo no mesmo event loop."""
from __future__ import annotations

import asyncio
import logging
import os

import uvicorn

from config import load_settings
from connection import AccountConnection
from notify import DailyStats, Notifier
from telemetry import create_app

log = logging.getLogger("main")


async def amain() -> None:
    settings = load_settings()
    log.info("%d conta(s) carregada(s)", len(settings.accounts))
    notifier = Notifier()
    daily = DailyStats()
    log.info("Webhook Discord: %s", "ligado" if notifier.enabled else "desligado")
    conns = [AccountConnection(a, settings, notifier, daily) for a in settings.accounts]

    host = os.getenv("TELEMETRY_HOST", "127.0.0.1")
    port = int(os.getenv("TELEMETRY_PORT", "8080"))
    token = os.getenv("TELEMETRY_TOKEN", "").strip()
    interval = float(os.getenv("TELEMETRY_INTERVAL_S", "1"))
    origins = [o.strip() for o in os.getenv("TELEMETRY_CORS_ORIGINS", "").split(",") if o.strip()]
    if not token and host not in ("127.0.0.1", "localhost", "::1"):
        log.warning("Telemetria exposta em %s SEM TELEMETRY_TOKEN: defina um token.", host)

    app = create_app(conns, token=token, interval=interval, cors_origins=origins)
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="warning"))
    server.install_signal_handlers = lambda: None  # o asyncio.run/KeyboardInterrupt cuida
    log.info("Telemetria em http://%s:%d (WS /ws/telemetry)", host, port)

    # Falha de uma conta nunca derruba as outras (run_forever captura erros).
    await asyncio.gather(server.serve(), notifier.run(), daily.run(notifier),
                         *(c.run_forever() for c in conns))


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

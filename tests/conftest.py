import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# Arquivos de estado vão para uma pasta temporária (nunca tocam nos dados reais).
_TMP = tempfile.mkdtemp(prefix="pokeidle-tests-")
os.environ["SESSION_FILE"] = os.path.join(_TMP, "session_state.json")
os.environ["DAILY_FILE"] = os.path.join(_TMP, "daily_state.json")
os.environ["DATA_DIR"] = os.path.join(_TMP, "data")
for _k in list(os.environ):
    if _k.startswith("ACC") or _k in ("TELEMETRY_TOKEN", "WS_URL", "DISCORD_WEBHOOK_URL", "PUBLIC_URL"):
        del os.environ[_k]

import pytest  # noqa: E402

from store import Store  # noqa: E402


@pytest.fixture
def store(tmp_path):
    return Store(str(tmp_path / "app.db"))

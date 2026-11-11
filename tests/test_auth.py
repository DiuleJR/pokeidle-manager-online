import pytest
from fastapi.testclient import TestClient

from auth import SESSION_COOKIE, Auth, hash_password, verify_password
from manager import AccountManager
from notify import DailyStats, Notifier
from telemetry import create_app

PW = "senha-forte-123"


def make(store, tmp_path, monkeypatch, *, env_token="", exposed=False, client=("127.0.0.1", 50000)):
    monkeypatch.setattr(AccountManager, "_spawn", lambda self, row: None)
    mgr = AccountManager(store, Notifier(""), DailyStats(path=str(tmp_path / "d.json")))
    auth = Auth(store, exposed=exposed, env_token=env_token)
    app = create_app(mgr.connections, auth, manager=mgr, store=store)
    return TestClient(app, client=client), auth


def test_hash_and_verify():
    h = hash_password(PW)
    assert h.startswith("scrypt$") and PW not in h
    assert verify_password(PW, h) and not verify_password("outra", h)
    assert not verify_password(PW, "lixo") and not verify_password(PW, "")
    assert hash_password(PW) != h  # sal aleatório


def test_first_access_setup_flow_local(store, tmp_path, monkeypatch):
    c, auth = make(store, tmp_path, monkeypatch)
    st = c.get("/api/auth/status").json()
    assert st["mode"] == "setup" and st["authenticated"] is False and st["needsCode"] is False
    assert c.get("/api/accounts").status_code == 401  # gestão bloqueada até criar a senha
    assert c.post("/api/auth/setup", json={"password": "curta"}).status_code == 400
    r = c.post("/api/auth/setup", json={"password": PW})
    assert r.status_code == 200 and SESSION_COOKIE in r.cookies
    assert "httponly" in r.headers["set-cookie"].lower() and "samesite=strict" in r.headers["set-cookie"].lower()
    assert c.get("/api/accounts").status_code == 200  # o cookie vale
    assert c.get("/api/auth/status").json() == {"mode": "login", "authenticated": True, "needsCode": False,
                                                 "passwordSet": True, "minPassword": 8}
    assert PW not in store.get_setting("pw_hash")
    assert c.post("/api/auth/setup", json={"password": "outra-senha-1"}).status_code == 409  # só uma vez


def test_remote_setup_requires_console_code(store, tmp_path, monkeypatch):
    c, auth = make(store, tmp_path, monkeypatch, client=("203.0.113.9", 4000))
    assert c.get("/api/auth/status").json()["needsCode"] is True
    assert c.post("/api/auth/setup", json={"password": PW}).status_code == 403
    assert c.post("/api/auth/setup", json={"password": PW, "code": "errado"}).status_code == 403
    r = c.post("/api/auth/setup", json={"password": PW, "code": auth.setup_code()})
    assert r.status_code == 200
    assert store.get_setting("setup_code") == ""  # código descartado


def test_reverse_proxy_is_not_treated_as_local(store, tmp_path, monkeypatch):
    c, _ = make(store, tmp_path, monkeypatch)  # cliente 127.0.0.1, mas com cabeçalho de proxy
    r = c.get("/api/auth/status", headers={"X-Forwarded-For": "198.51.100.7"})
    assert r.json()["needsCode"] is True
    c2, _ = make(store, tmp_path, monkeypatch, exposed=True)
    assert c2.get("/api/auth/status").json()["needsCode"] is True


def test_login_logout_and_wrong_password(store, tmp_path, monkeypatch):
    c, auth = make(store, tmp_path, monkeypatch)
    c.post("/api/auth/setup", json={"password": PW})
    c.post("/api/auth/logout")
    assert c.get("/api/accounts").status_code == 401
    assert c.post("/api/auth/login", json={"password": "errada"}).status_code == 401
    assert c.post("/api/auth/login", json={"password": PW}).status_code == 200
    assert c.get("/api/accounts").status_code == 200
    c.post("/api/auth/logout")
    assert c.get("/api/accounts").status_code == 401


def test_login_is_rate_limited(store, tmp_path, monkeypatch):
    c, _ = make(store, tmp_path, monkeypatch)
    c.post("/api/auth/setup", json={"password": PW})
    c.post("/api/auth/logout")
    codes = [c.post("/api/auth/login", json={"password": "x"}).status_code for _ in range(12)]
    assert codes[:10] == [401] * 10 and codes[10:] == [429, 429]
    assert c.post("/api/auth/login", json={"password": PW}).status_code == 429  # nem a certa passa


def test_telemetry_token_still_works_as_bearer_and_as_password(store, tmp_path, monkeypatch):
    c, _ = make(store, tmp_path, monkeypatch, env_token="chave-da-vps")
    assert c.get("/api/auth/status").json()["mode"] == "login"  # sem etapa de criar senha
    assert c.get("/api/accounts").status_code == 401
    assert c.get("/api/accounts", headers={"Authorization": "Bearer chave-da-vps"}).status_code == 200
    assert c.get("/api/accounts?token=chave-da-vps").status_code == 200
    assert c.post("/api/auth/login", json={"password": "chave-da-vps"}).status_code == 200
    assert c.get("/api/accounts").status_code == 200  # agora pelo cookie


def test_reads_are_open_only_until_a_password_exists(store, tmp_path, monkeypatch):
    c, _ = make(store, tmp_path, monkeypatch)
    assert c.get("/api/telemetry").status_code == 200  # 1º acesso local: nada a proteger ainda
    c.post("/api/auth/setup", json={"password": PW})
    c.post("/api/auth/logout")
    assert c.get("/api/telemetry").status_code == 401
    c.post("/api/auth/login", json={"password": PW})
    assert c.get("/api/telemetry").status_code == 200


def test_exposed_server_protects_reads_even_in_setup(store, tmp_path, monkeypatch):
    c, _ = make(store, tmp_path, monkeypatch, exposed=True)
    assert c.get("/api/telemetry").status_code == 401


def test_websocket_requires_login(store, tmp_path, monkeypatch):
    c, _ = make(store, tmp_path, monkeypatch)
    c.post("/api/auth/setup", json={"password": PW})
    with c.websocket_connect("/ws/telemetry") as ws:  # cookie enviado no handshake
        assert ws.receive_json()["type"] == "snapshot"
    c.post("/api/auth/logout")
    with pytest.raises(Exception):
        with c.websocket_connect("/ws/telemetry"):
            pass


def test_change_password_drops_other_sessions(store, tmp_path, monkeypatch):
    c, _ = make(store, tmp_path, monkeypatch)
    c.post("/api/auth/setup", json={"password": PW})
    other = TestClient(c.app, client=("127.0.0.1", 50001))
    assert other.post("/api/auth/login", json={"password": PW}).status_code == 200
    assert other.get("/api/accounts").status_code == 200
    assert c.post("/api/auth/password", json={"current": "errada", "new": "nova-senha-123"}).status_code == 403
    assert c.post("/api/auth/password", json={"current": PW, "new": "curta"}).status_code == 400
    assert c.post("/api/auth/password", json={"current": PW, "new": "nova-senha-123"}).status_code == 200
    assert c.get("/api/accounts").status_code == 200       # esta sessão continua
    assert other.get("/api/accounts").status_code == 401   # as outras caíram
    c.post("/api/auth/logout")
    assert c.post("/api/auth/login", json={"password": PW}).status_code == 401
    assert c.post("/api/auth/login", json={"password": "nova-senha-123"}).status_code == 200


def test_set_first_password_when_logged_in_with_token(store, tmp_path, monkeypatch):
    c, _ = make(store, tmp_path, monkeypatch, env_token="chave-da-vps")
    c.post("/api/auth/login", json={"password": "chave-da-vps"})
    assert c.post("/api/auth/password", json={"new": PW}).status_code == 200  # sem senha atual
    assert store.get_setting("pw_hash") != ""


def test_reset_clears_password_and_sessions(store, tmp_path, monkeypatch):
    c, auth = make(store, tmp_path, monkeypatch)
    c.post("/api/auth/setup", json={"password": PW})
    auth.reset()
    assert c.get("/api/accounts").status_code == 401
    assert c.get("/api/auth/status").json()["mode"] == "setup"


def test_rate_limit_is_per_client_ip_behind_proxy(store):
    from types import SimpleNamespace

    from auth import Auth

    def req(peer, fwd=None):
        return SimpleNamespace(client=SimpleNamespace(host=peer), headers={"x-forwarded-for": fwd} if fwd else {})

    a = Auth(store, exposed=False, env_token="")
    attacker, owner = req("127.0.0.1", "1.2.3.4"), req("127.0.0.1", "5.6.7.8")
    for _ in range(10):
        a.fail(attacker)
    assert a.limited(attacker) and not a.limited(owner)  # o atacante não tranca o dono
    spoof = req("9.9.9.9", "5.6.7.8")  # de par não-local o cabeçalho é ignorado
    assert a.client_ip(spoof) == "9.9.9.9"


def test_hunt_worker_is_confined_by_its_own_csp(store, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from telemetry import create_app

    (tmp_path / "hunt-worker.js").write_text("// worker")
    (tmp_path / "index.html").write_text("<html></html>")
    monkeypatch.setenv("WEB_DIR", str(tmp_path))
    c = TestClient(create_app([], Auth(store, exposed=False, env_token="")))
    worker = c.get("/hunt-worker.js").headers["content-security-policy"]
    assert "pokeidle-gg.pages.dev" in worker and "'self'" not in worker   # não alcança a nossa API
    assert "'self'" in c.get("/").headers["content-security-policy"]       # o painel segue com a CSP normal

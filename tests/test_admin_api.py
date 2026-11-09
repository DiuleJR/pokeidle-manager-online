import json

import pytest
from fastapi.testclient import TestClient

import admin_api
from auth import Auth
from manager import AccountManager
from notify import DailyStats, Notifier
from telemetry import create_app

KEY = "chave-de-teste"
H = {"Authorization": f"Bearer {KEY}"}
TOKEN = "tok_" + "z" * 30
GOOD_JSON = json.dumps({"nick": "Ash", "token": TOKEN, "dispositivo": "dev-12345678"})


@pytest.fixture
def client(store, tmp_path, monkeypatch):
    async def fake_probe(acc, ws_url, timeout=25.0):
        if acc.token.endswith("BAD"):
            return {"ok": False, "kind": "invalid", "detail": "Sessão inválida ou expirada: reimporte a conta"}
        return {"ok": True, "kind": "ok", "detail": "", "nick": acc.nick.upper(), "level": 7, "hunts": []}

    monkeypatch.setattr(admin_api, "probe_account", fake_probe)
    monkeypatch.setattr(AccountManager, "_spawn", lambda self, row: None)  # sem rede
    mgr = AccountManager(store, Notifier(""), DailyStats(path=str(tmp_path / "d.json")))
    app = create_app(mgr.connections, Auth(store, exposed=False, env_token=KEY), manager=mgr, store=store)
    c = TestClient(app)
    c.store = store
    return c


def post(c, body):
    return c.post("/api/accounts/import", json=body, headers=H)


def test_requires_key(client):
    assert client.get("/api/accounts").status_code == 401
    assert client.get("/api/accounts", headers={"Authorization": "Bearer errada"}).status_code == 401
    assert client.get("/api/accounts", headers=H).status_code == 200
    assert client.get(f"/api/accounts?token={KEY}").status_code == 200


def test_brute_force_is_limited(client):
    bad = {"Authorization": "Bearer x"}
    codes = [client.get("/api/accounts", headers=bad).status_code for _ in range(12)]
    assert codes[:10] == [401] * 10 and codes[10] == 429
    assert client.get("/api/accounts", headers=H).status_code == 429  # bloqueado até com a chave certa


@pytest.mark.parametrize("text", [
    GOOD_JSON,
    json.dumps({"t": "hello", "nick": "Ash", "token": TOKEN, "delta": 1, "dispositivo": "dev-12345678"}),
    "frame: " + GOOD_JSON,
    json.dumps({"sessao": json.dumps({"nick": "Ash", "token": TOKEN}), "id-dispositivo": "dev-12345678"}),
])
def test_import_accepts_formats(client, text):
    r = post(client, {"text": text})
    assert r.status_code == 200 and r.json()["ok"] is True, r.text
    acc = r.json()["account"]
    assert acc["nick"] == "ASH"  # o nome oficial vem do welcome
    assert TOKEN not in r.text and "z" * 20 not in r.text  # token nunca volta pela API
    assert client.store.get_account(acc["numericId"])["device_id"] == "dev-12345678"


def test_import_generates_device_and_warns_without_proxy(client):
    j = post(client, {"nick": "Ash", "token": TOKEN}).json()
    assert j["generatedDevice"] is True
    assert any("sem proxy" in w for w in j["warnings"])


@pytest.mark.parametrize("body", [
    {"text": ""}, {"text": "abc"}, {"text": json.dumps({"nick": "A"})},
    {"nick": "Ash", "token": "curto"}, {"nick": "", "token": TOKEN},
    {"nick": "Ash", "token": TOKEN, "device_id": "inválido!"},
])
def test_import_rejects_bad_input(client, body):
    r = post(client, body)
    assert r.status_code == 400 and "error" in r.json()
    assert client.store.count_accounts() == 0


def test_failed_probe_does_not_save_but_skip_test_does(client):
    bad = {"nick": "Ash", "token": "tok_" + "y" * 20 + "BAD"}
    r = post(client, bad)
    assert r.status_code == 200 and r.json()["ok"] is False and r.json()["test"]["kind"] == "invalid"
    assert client.store.count_accounts() == 0
    assert post(client, {**bad, "skip_test": True}).json()["ok"] is True
    assert client.store.count_accounts() == 1


def test_duplicate_and_limit(client):
    assert post(client, {"text": GOOD_JSON}).json()["ok"]
    assert post(client, {"text": GOOD_JSON}).status_code == 409
    for i in range(3):
        assert post(client, {"nick": f"N{i}", "token": f"tok_{i}" + "q" * 20}).json()["ok"]
    r = post(client, {"nick": "Quinta", "token": "tok_5" + "q" * 20})
    assert r.status_code == 409 and "Limite" in r.json()["error"]


def test_patch_keeps_proxy_password_and_can_remove_proxy(client):
    acc = post(client, {"nick": "Ash", "token": TOKEN,
                        "proxy": {"scheme": "socks5", "host": "h", "port": 1080,
                                  "username": "u", "password": "seg"}}).json()["account"]
    assert acc["proxy"]["hasPassword"] is True and "seg" not in json.dumps(acc)
    i = acc["numericId"]
    r = client.patch(f"/api/accounts/{i}", headers=H,
                     json={"proxy": {"scheme": "socks5", "host": "novo", "port": 1081, "username": "u"}})
    assert r.status_code == 200
    row = client.store.get_account(i)
    assert row["proxy"]["host"] == "novo" and row["proxy"]["password"] == "seg"  # senha mantida
    client.patch(f"/api/accounts/{i}", headers=H, json={"proxy": None})
    assert client.store.get_account(i)["proxy"] is None
    r = client.patch(f"/api/accounts/{i}", headers=H, json={"proxy": {"scheme": "ftp", "host": "h", "port": 1}})
    assert r.status_code == 400
    assert client.patch("/api/accounts/999", headers=H, json={"nick": "x"}).status_code == 404


def test_toggle_restart_delete(client):
    i = post(client, {"text": GOOD_JSON}).json()["account"]["numericId"]
    r = client.patch(f"/api/accounts/{i}", headers=H, json={"enabled": False})
    assert r.json()["account"]["enabled"] is False and r.json()["account"]["state"] == "STOPPED"
    assert client.post(f"/api/accounts/{i}/restart", headers=H).status_code == 200
    assert client.delete(f"/api/accounts/{i}", headers=H).status_code == 200
    assert client.delete(f"/api/accounts/{i}", headers=H).status_code == 404


def test_settings_validation_and_secret_masking(client):
    hook = "https://discord.com/api/webhooks/123456/abcDEF-_ghi"
    assert client.put("/api/settings", headers=H, json={"discord_webhook": "http://evil.example/x"}).status_code == 400
    assert client.put("/api/settings", headers=H, json={"ws_url": "http://x"}).status_code == 400
    assert client.put("/api/settings", headers=H, json={"report_tz": "Marte/Olimpo"}).status_code == 400
    assert client.put("/api/settings", headers=H, json={"report_hour": 24}).status_code == 422
    r = client.put("/api/settings", headers=H, json={"discord_webhook": hook, "report_hour": 5,
                                                      "public_url": "https://x.example/"})
    j = r.json()
    assert r.status_code == 200 and j["hasWebhook"] is True and hook not in r.text
    assert j["public_url"] == "https://x.example" and j["report_hour"] == 5
    client.put("/api/settings", headers=H, json={"report_hour": 6})  # sem o campo: mantém o webhook
    assert client.get("/api/settings", headers=H).json()["hasWebhook"] is True
    client.put("/api/settings", headers=H, json={"discord_webhook": ""})  # vazio: limpa
    assert client.get("/api/settings", headers=H).json()["hasWebhook"] is False

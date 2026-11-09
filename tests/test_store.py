import os

import pytest

import config
from store import Store, mask

BASE = {"nick": "Ash", "token": "tok_aaaaaaaaaaaaaaaaaaaa", "device_id": "dev-12345678"}


def test_crud_and_options_merge(store):
    acc_id = store.add_account({**BASE, "proxy": {"scheme": "socks5", "host": "h", "port": 1080,
                                                  "username": "u", "password": "p"}})
    row = store.get_account(acc_id)
    assert row["proxy"]["password"] == "p" and row["enabled"] is True
    store.update_account(acc_id, {"options": {"auto_catch": False}})
    store.update_account(acc_id, {"options": {"auto_potion": False}})
    assert store.get_account(acc_id)["options"] == {"auto_catch": False, "auto_potion": False}
    store.update_account(acc_id, {"proxy": None})
    assert store.get_account(acc_id)["proxy"] is None
    store.delete_account(acc_id)
    assert store.get_account(acc_id) is None


def test_token_change_resets_status_but_renewal_does_not(store):
    i = store.add_account({"nick": "A", "token": "t" * 20, "device_id": "d" * 10})
    store.set_token_status(i, "invalid", "venceu")
    store.set_token(i, "n" * 20)  # sessao.renovada
    assert store.get_account(i)["token_status"] == "invalid"
    store.update_account(i, {"token": "m" * 20})  # reimportado pelo usuário
    assert store.get_account(i)["token_status"] == "unknown"


def test_ids_are_not_reused(store):
    a = store.add_account({"nick": "A", "token": "t" * 20, "device_id": "d" * 10})
    store.delete_account(a)
    b = store.add_account({"nick": "B", "token": "u" * 20, "device_id": "e" * 10})
    assert b > a


def test_mask_never_returns_secret():
    assert mask("") == ""
    assert mask("abc") == "…"
    m = mask("0123456789abcdef")
    assert m == "…cdef" and "0123" not in m


def test_sessions_expire_and_can_be_cleared(store):
    import time
    store.add_session("a" * 64, time.time() + 60)
    store.add_session("b" * 64, time.time() - 1)  # já vencida
    assert store.session_valid("a" * 64) is True
    assert store.session_valid("b" * 64) is False
    assert store.session_valid("c" * 64) is False
    store.delete_session("a" * 64)
    assert store.session_valid("a" * 64) is False
    store.add_session("d" * 64, time.time() + 60)
    store.clear_sessions()
    assert store.session_valid("d" * 64) is False


def test_import_env_once(store, monkeypatch):
    monkeypatch.setenv("ACC2_NICK", "Misty")
    monkeypatch.setenv("ACC2_TOKEN", "tok_" + "x" * 20)
    monkeypatch.setenv("ACC2_DEVICE_ID", "dev-99999999")
    monkeypatch.setenv("ACC2_PROXY_HOST", "px.example")
    monkeypatch.setenv("ACC2_PROXY_PORT", "1080")
    monkeypatch.setenv("ACC2_AUTO_CATCH", "false")
    monkeypatch.setenv("WS_URL", "wss://outro.example")
    monkeypatch.setenv("PUBLIC_URL", "https://x.example/")
    assert store.import_env_once() == 1
    row = store.get_account(2)  # preserva o id (acc2)
    assert row["nick"] == "Misty" and row["proxy"]["host"] == "px.example"
    assert row["options"]["auto_catch"] is False
    assert store.get_setting("ws_url") == "wss://outro.example"
    assert store.get_setting("public_url") == "https://x.example"
    assert store.import_env_once() == 0  # só uma vez


def test_import_env_ignores_placeholder_ws_url(store, monkeypatch):
    monkeypatch.setenv("WS_URL", "wss://CHANGE_ME")
    store.import_env_once()
    assert store.get_setting("ws_url") == config.DEFAULT_WS_URL


def test_build_account_config_defaults_and_validation():
    acc = config.build_account_config({"id": 3, "nick": "N", "token": "t", "device_id": "d",
                                       "proxy": {"scheme": "http", "host": "h", "port": "8080"}})
    assert acc.index == 3 and acc.proxy.url == "http://h:8080" and acc.auto_catch is True
    assert acc.ball_priority == (1, 2, 3, 4)
    with pytest.raises(ValueError):
        config.build_account_config({"id": 1, "nick": "N", "token": "t", "device_id": "d",
                                     "proxy": {"scheme": "ftp", "host": "h", "port": 1}})


@pytest.mark.skipif(os.name == "nt", reason="chmod 0600 não se aplica ao Windows")
def test_db_file_is_private(tmp_path):
    p = tmp_path / "x.db"
    Store(str(p))
    assert (p.stat().st_mode & 0o777) == 0o600

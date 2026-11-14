import asyncio
import io
import os
import shutil
import subprocess
import sys
import zipfile

import pytest
from fastapi.testclient import TestClient

import updater as up
from auth import Auth
from telemetry import create_app

KEY = "chave-de-teste"
H = {"Authorization": f"Bearer {KEY}"}
ASSET = up.ASSET_PREFIX + "v1.0.1/web_dist.zip"


def release(tag="v1.0.1", with_asset=True, body="Novidades"):
    return {"tag_name": tag, "body": body, "html_url": "https://github.com/x/y/releases/tag/" + tag,
            "assets": [{"name": "web_dist.zip", "browser_download_url": ASSET}] if with_asset else []}


def zip_bytes(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()


# ---------------------------------------------------------------- versões e Release
def test_parse_version():
    assert up.parse_version("v1.2.3") == (1, 2, 3)
    assert up.parse_version("1.10.0") > up.parse_version("1.9.9")
    assert up.parse_version("v1.2") is None and up.parse_version("latest") is None


def test_available_only_when_newer_and_asset_ready():
    u = up.Updater(current="1.0.0")
    u._read_release(release())
    assert u.latest == "1.0.1" and u.available and u.notes == "Novidades"
    # Release sem o zip do dashboard = workflow ainda rodando: não oferece
    u2 = up.Updater(current="1.0.0")
    u2._read_release(release(with_asset=False))
    assert u2.latest == "1.0.1" and not u2.available
    # mesma versão ou mais velha: nada a fazer
    u3 = up.Updater(current="1.0.1")
    u3._read_release(release())
    assert not u3.available


def test_rejects_weird_tag_and_foreign_asset():
    u = up.Updater(current="1.0.0")
    with pytest.raises(up.UpdateError):
        u._read_release(release(tag="nightly"))
    data = release()
    data["assets"][0]["browser_download_url"] = "https://evil.example.com/web_dist.zip"
    u._read_release(data)
    assert u.asset_url == "" and not u.available


# ---------------------------------------------------------------- rotas
@pytest.fixture
def client(store):
    u = up.Updater(current="1.0.0")
    u._read_release(release())

    async def fake_check():
        u.checked_at = 123.0
        return u.public()

    u.check = fake_check
    app = create_app([], Auth(store, exposed=False, env_token=KEY), updater=u)
    c = TestClient(app)
    c.u = u
    return c


def test_routes_require_login(client):
    for method, path in (("get", "/api/update"), ("post", "/api/update/check"), ("post", "/api/update/apply")):
        assert getattr(client, method)(path).status_code == 401


def test_state_and_manual_check(client):
    s = client.get("/api/update", headers=H).json()
    assert s["current"] == "1.0.0" and s["latest"] == "1.0.1" and s["available"] is True
    assert "token" not in str(s).lower()
    assert client.post("/api/update/check", headers=H).json()["checkedAt"] == 123.0


def test_apply_refuses_without_git_clone(client, tmp_path):
    client.u.root = str(tmp_path)  # sem .git
    r = client.post("/api/update/apply", headers=H)
    assert r.status_code == 409 and "git clone" in r.json()["error"]


# ---------------------------------------------------------------- aplicar de verdade (git local)
GIT_ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
           "GIT_COMMITTER_EMAIL": "t@t"}


def git(cwd, *a):
    return subprocess.run(["git", *a], cwd=cwd, env=GIT_ENV, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repos(tmp_path):
    if not shutil.which("git"):
        pytest.skip("git não instalado")
    origin, work = tmp_path / "origin", tmp_path / "work"
    origin.mkdir()
    git(origin, "init", "-q", "-b", "main")
    (origin / "requirements.txt").write_text("aiohttp\n")
    (origin / "app.txt").write_text("v1")
    git(origin, "add", "-A")
    git(origin, "commit", "-qm", "1")
    git(origin, "tag", "v1.0.0")
    subprocess.run(["git", "clone", "-q", str(origin), str(work)], check=True, env=GIT_ENV)
    (origin / "app.txt").write_text("v2")
    git(origin, "commit", "-qam", "2")
    git(origin, "tag", "v1.0.1")
    return origin, work


def make_updater(work, monkeypatch, pip_fails=False):
    u = up.Updater(root=str(work), current="1.0.0")
    u.supervised = False
    u._read_release(release())

    async def fake_dl():
        return zip_bytes({"index.html": "<html>novo"})

    u._download_dashboard = fake_dl
    real = u._exec

    async def exec_(cmd, timeout, env=None):
        if cmd[0] == sys.executable:  # pip: não instala nada de verdade nos testes
            if pip_fails:
                raise up.UpdateError("pip quebrou")
            return ""
        return await real(cmd, timeout, env)

    u._exec = exec_
    return u


def test_apply_updates_code_and_dashboard(repos, monkeypatch):
    origin, work = repos
    u = make_updater(work, monkeypatch)
    res = asyncio.run(u.apply())
    assert res["ok"] and res["restarting"] is False and "1.0.1" in res["message"]
    assert (work / "app.txt").read_text() == "v2"
    assert (work / "web_dist" / "index.html").read_text() == "<html>novo"
    assert u.step == ""


def test_apply_refuses_dirty_tree(repos, monkeypatch):
    origin, work = repos
    (work / "app.txt").write_text("alterei")
    u = make_updater(work, monkeypatch)
    with pytest.raises(up.UpdateError, match="modificados"):
        asyncio.run(u.apply())
    assert (work / "app.txt").read_text() == "alterei"


def test_apply_rolls_back_when_install_fails(repos, monkeypatch):
    origin, work = repos
    before = git(work, "rev-parse", "HEAD")
    u = make_updater(work, monkeypatch, pip_fails=True)
    with pytest.raises(up.UpdateError, match="desfeita"):
        asyncio.run(u.apply())
    assert git(work, "rev-parse", "HEAD") == before and (work / "app.txt").read_text() == "v1"
    assert not (work / "web_dist").exists()


def test_apply_refuses_diverged_copy(repos, monkeypatch):
    origin, work = repos
    (work / "meu.txt").write_text("commit local")
    git(work, "add", "-A")
    git(work, "commit", "-qm", "local")
    u = make_updater(work, monkeypatch)
    with pytest.raises(up.UpdateError, match="Não consegui aplicar"):
        asyncio.run(u.apply())
    assert (work / "app.txt").read_text() == "v1"


# ---------------------------------------------------------------- download do dashboard (servidor de verdade)
def _serve_zip(payload: bytes, chunk=8192):
    from aiohttp import web

    async def handler(request):
        resp = web.StreamResponse()
        await resp.prepare(request)
        for i in range(0, len(payload), chunk):  # em pedaços, como a rede de verdade
            await resp.write(payload[i:i + chunk])
            await asyncio.sleep(0.001)
        return resp

    app = web.Application()
    app.router.add_get("/web_dist.zip", handler)
    return app


def _download(payload, monkeypatch, max_bytes=None):
    from aiohttp.test_utils import TestServer

    async def go():
        async with TestServer(_serve_zip(payload)) as srv:
            base = str(srv.make_url("/"))
            monkeypatch.setattr(up, "ASSET_PREFIX", base)
            if max_bytes:
                monkeypatch.setattr(up, "MAX_ZIP_BYTES", max_bytes)
            u = up.Updater(current="1.0.0")
            u.asset_url = base + "web_dist.zip"
            return await u._download_dashboard()

    return asyncio.run(go())


def test_download_reads_whole_file_not_just_first_chunk(monkeypatch):
    import random
    rnd = random.Random(1)
    big = zip_bytes({"index.html": "<html>", "assets/app.js": "".join(chr(rnd.randrange(97, 123)) for _ in range(400_000))})
    assert len(big) > 150_000
    assert _download(big, monkeypatch) == big


def test_download_rejects_too_big(monkeypatch):
    with pytest.raises(up.UpdateError, match="grande demais"):
        _download(b"x" * 50_000, monkeypatch, max_bytes=10_000)


# ---------------------------------------------------------------- app do Windows (instalador)
INSTALLER = up.ASSET_PREFIX + "v1.0.1/PokeIdleManager-Setup.exe"


def installer_release(digest=""):
    r = release()
    r["assets"].append({"name": up.INSTALLER_NAME, "browser_download_url": INSTALLER, "digest": digest})
    return r


def test_frozen_update_needs_the_installer_asset(monkeypatch):
    monkeypatch.setattr(up, "FROZEN", True)
    u = up.Updater(current="1.0.0")
    u._read_release(release())                       # só o zip do dashboard: instalador ainda não saiu
    assert not u.available
    u._read_release(installer_release("sha256:" + "a" * 64))
    assert u.available and u.installer_sha256 == "a" * 64
    assert u.git_reason() == ""                      # não depende de git clone


def test_frozen_update_rejects_foreign_installer_url(monkeypatch):
    monkeypatch.setattr(up, "FROZEN", True)
    u = up.Updater(current="1.0.0")
    r = installer_release()
    r["assets"][1]["browser_download_url"] = "https://evil.example/PokeIdleManager-Setup.exe"
    u._read_release(r)
    assert not u.available and u.installer_url == ""


def test_frozen_apply_refuses_a_download_that_does_not_match(monkeypatch):
    monkeypatch.setattr(up, "FROZEN", True)
    u = up.Updater(current="1.0.0")
    u._read_release(installer_release("sha256:" + "0" * 64))

    class Resp:
        status = 200

        class content:
            @staticmethod
            async def iter_chunked(n):
                yield b"MZ" + b"x" * 100

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class Sess:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        def get(self, *a, **k): return Resp()

    started = []
    monkeypatch.setattr(up.aiohttp, "ClientSession", Sess)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: started.append(a))
    with pytest.raises(up.UpdateError, match="não confere"):
        asyncio.run(u.apply())
    assert started == []                             # instalador adulterado nunca é executado

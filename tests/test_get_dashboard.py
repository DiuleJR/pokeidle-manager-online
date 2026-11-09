import importlib.util
import io
import os
import zipfile

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("get_dashboard", os.path.join(ROOT, "scripts", "get_dashboard.py"))
gd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gd)


def make_zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def test_install_replaces_dashboard(tmp_path):
    dest = tmp_path / "web_dist"
    dest.mkdir()
    (dest / "velho.txt").write_text("x")
    gd.install(make_zip({"index.html": "<html>", "assets/app.js": "1"}), str(dest))
    assert (dest / "index.html").read_text() == "<html>" and (dest / "assets" / "app.js").exists()
    assert not (dest / "velho.txt").exists()
    assert not os.path.exists(str(dest) + ".novo")


def test_rejects_zip_slip_and_keeps_old_dashboard(tmp_path):
    dest = tmp_path / "web_dist"
    dest.mkdir()
    (dest / "index.html").write_text("antigo")
    with pytest.raises(ValueError):
        gd.install(make_zip({"index.html": "x", "../fora.txt": "mal"}), str(dest))
    assert (dest / "index.html").read_text() == "antigo"
    assert not (tmp_path / "fora.txt").exists()


def test_rejects_zip_without_index(tmp_path):
    dest = tmp_path / "web_dist"
    with pytest.raises(ValueError):
        gd.install(make_zip({"outro.txt": "x"}), str(dest))
    assert not dest.exists()


def test_main_reports_failure(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["get_dashboard.py", (tmp_path / "nao-existe.zip").as_uri()])
    assert gd.main() == 1
    assert "Não consegui baixar" in capsys.readouterr().err

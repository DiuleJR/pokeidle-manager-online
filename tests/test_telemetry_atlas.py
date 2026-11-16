"""Atlas de retratos: a imagem leva a versão (sem isso o cache do navegador embaralha os sprites)."""
from telemetry import atlas_payload


def test_image_gets_version_when_missing():
    p = atlas_payload({"cols": 16, "rows": 71, "version": "abc", "image": "/x/atlas.png", "slots": {"1": [0, 0]}})
    assert p["image"].endswith("/x/atlas.png?v=abc") and p["version"] == "abc"


def test_image_keeps_version_already_there():
    p = atlas_payload({"version": "abc", "image": "/x/atlas.png?v=abc"})
    assert p["image"].count("v=") == 1


def test_old_atlas_without_version_still_works():
    p = atlas_payload({"slots": {}})
    assert p["image"].endswith("marker-atlas.png") and p["version"] == ""

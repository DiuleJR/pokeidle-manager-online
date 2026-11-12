#!/usr/bin/env python3
"""Posta o changelog de uma versão no canal do Discord (webhook), com as imagens de changelog/<tag>/.

Uso:
    python3 scripts/post_changelog.py --tag v1.5.0 --dry-run     # só mostra como ficaria (não envia)
    DISCORD_CHANGELOG_WEBHOOK=... python3 scripts/post_changelog.py --tag v1.5.0

O texto vem do RELEASE_NOTES.md daquela tag (git show <tag>:RELEASE_NOTES.md; se não der, o arquivo atual).
As imagens vêm de changelog/<tag>/ (até 10, em ordem de nome). A URL do webhook é um segredo: fica só na
variável de ambiente DISCORD_CHANGELOG_WEBHOOK (segredo do repositório no GitHub), nunca no código.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_CHARS = 1900          # o Discord aceita 2000 por mensagem
MAX_IMAGES = 10
MAX_BYTES = 8 * 1024 * 1024
DEFAULT_REPO = "DiuleJR/pokeidle-manager-online"
NAME = "PokéIdle Manager Online"

# Emoji de cada seção (pela palavra-chave do título); o resto leva ✨.
SECTION_EMOJI = [
    ("sniper", "🎯"), ("discord", "💬"), ("automa", "🛒"), ("mercado", "🛒"), ("mapa", "🗺️"),
    ("dashboard", "📊"), ("corre", "🛠️"), ("celular", "📱"), ("hunt", "🎯"),
]


def read_notes(tag: str) -> str:
    try:
        out = subprocess.run(["git", "show", f"{tag}:RELEASE_NOTES.md"], cwd=ROOT, capture_output=True, check=True)
        return out.stdout.decode("utf-8")     # bytes: o texto do console do Windows não é UTF-8
    except (subprocess.CalledProcessError, FileNotFoundError):
        return (ROOT / "RELEASE_NOTES.md").read_text(encoding="utf-8")


def to_discord(notes: str) -> str:
    """Markdown das notas -> texto do Discord: títulos de seção com emoji, listas com marcador."""
    lines = []
    for raw in notes.splitlines():
        line = raw.rstrip()
        if line.startswith("## "):          # "## Novidades": já vai no título geral
            continue
        m = re.fullmatch(r"\*\*(.+?)\*\*", line.strip())
        if m:                                # linha só em negrito = título de seção
            title = m.group(1)
            emoji = next((e for k, e in SECTION_EMOJI if k in title.lower()), "✨")
            lines.append(f"### {emoji} {title}")
            continue
        lines.append(re.sub(r"^- ", "• ", line))
    text = "\n".join(lines).strip()
    return re.sub(r"\n{3,}", "\n\n", text)


def chunk(text: str, limit: int = MAX_CHARS) -> list[str]:
    """Divide em mensagens de até `limit` caracteres, sempre entre blocos (nunca no meio de uma linha)."""
    parts, cur = [], ""
    for block in re.split(r"\n(?=### )", text):
        if len(cur) + len(block) + 1 > limit and cur:
            parts.append(cur.strip())
            cur = ""
        while len(block) > limit:             # bloco enorme: quebra por linha
            cut = block.rfind("\n", 0, limit)
            cut = cut if cut > 0 else limit
            parts.append((cur + block[:cut]).strip())
            cur, block = "", block[cut:].lstrip("\n")
        cur = f"{cur}\n{block}" if cur else block
    if cur.strip():
        parts.append(cur.strip())
    return parts


def build_messages(tag: str, repo: str, images: list[Path]) -> list[dict]:
    body = to_discord(read_notes(tag))
    parts = chunk(body, MAX_CHARS - 60)    # folga para o título que entra na 1ª mensagem
    url = f"https://github.com/{repo}"   # link do repositório (sem pré-visualização, por causa dos <>)
    parts[0] = f"# 🚀 {NAME} {tag}\n{parts[0]}"
    parts.append(f"🔗 **Download oficial:** <{url}>")
    msgs = [{"content": p, "files": []} for p in parts]
    msgs[-1]["files"] = images      # as imagens vão na última mensagem, junto do link
    return msgs


def find_images(tag: str) -> list[Path]:
    d = ROOT / "changelog" / tag
    if not d.is_dir():
        return []
    files = sorted(p for p in d.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif"))
    ok = [p for p in files if p.stat().st_size <= MAX_BYTES]
    return ok[:MAX_IMAGES]


def multipart(payload: dict, files: list[Path]) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    out = bytearray()

    def part(headers: str, data: bytes) -> None:
        out.extend(f"--{boundary}\r\n{headers}\r\n\r\n".encode() + data + b"\r\n")

    part('Content-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json', json.dumps(payload).encode())
    for i, f in enumerate(files):
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        part(f'Content-Disposition: form-data; name="files[{i}]"; filename="{f.name}"\r\nContent-Type: {ctype}', f.read_bytes())
    out.extend(f"--{boundary}--\r\n".encode())
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def send(webhook: str, msg: dict) -> None:
    payload = {"content": msg["content"], "allowed_mentions": {"parse": []}}   # nunca marca ninguém
    if msg["files"]:
        payload["attachments"] = [{"id": i, "filename": f.name} for i, f in enumerate(msg["files"])]
        data, ctype = multipart(payload, msg["files"])
    else:
        data, ctype = json.dumps(payload).encode(), "application/json"
    for attempt in range(4):
        req = urllib.request.Request(webhook, data=data, headers={"Content-Type": ctype, "User-Agent": "pokeidle-changelog/1"}, method="POST")
        try:
            urllib.request.urlopen(req, timeout=60).read()
            return
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(float(json.loads(e.read() or b"{}").get("retry_after", 1.5)) + 0.2)
                continue
            raise SystemExit(f"Discord recusou a mensagem (HTTP {e.code}).")
    raise SystemExit("Discord limitou o envio (muitas tentativas).")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")   # o console do Windows usa cp1252 e quebraria nos emojis
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True, help="ex.: v1.5.0")
    ap.add_argument("--repo", default=os.getenv("GITHUB_REPOSITORY", DEFAULT_REPO))
    ap.add_argument("--dry-run", action="store_true", help="só mostra as mensagens, não envia")
    a = ap.parse_args()

    msgs = build_messages(a.tag, a.repo, find_images(a.tag))
    if a.dry_run:
        for i, m in enumerate(msgs, 1):
            print(f"──────── mensagem {i}/{len(msgs)} ({len(m['content'])} caracteres) ────────")
            print(m["content"])
            if m["files"]:
                print("\n[anexos] " + ", ".join(f"{f.name} ({f.stat().st_size // 1024} KB)" for f in m["files"]))
        return 0

    webhook = os.getenv("DISCORD_CHANGELOG_WEBHOOK", "").strip()
    if not webhook:
        print("DISCORD_CHANGELOG_WEBHOOK não está definido: nada foi enviado.")
        return 0
    for m in msgs:
        send(webhook, m)
        time.sleep(1)
    print(f"Changelog de {a.tag} enviado ({len(msgs)} mensagens).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

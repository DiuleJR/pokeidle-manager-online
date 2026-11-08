"""Gera versões padronizadas dos ícones de itens raros (pokeidle.io), usadas
nas notificações do Discord (thumbnail) e, futuramente, no dashboard.

Os PNGs originais do jogo têm quantidades de margem transparente bem
diferentes entre si (o Bronze Boss Token quase preenche o canvas 32x32; os
"fragmentos" ocupam só ~60% dele) — isso faz os ícones parecerem com
tamanhos diferentes quando exibidos num quadro de tamanho fixo (ex.: o
thumbnail de um embed do Discord). Este script corta cada ícone pelo seu
conteúdo visível (bounding box sem transparência) e recoloca, escalado, no
centro de um canvas quadrado padrão, com a mesma proporção de preenchimento
para todos.

Saída: web/public/rare-icons/{boss,key,shinyStone,bike}.png (chaves iguais
às de session_stats.TRACKED). Uso: python scripts/gen_rare_icons.py
"""
from __future__ import annotations

import os
import urllib.request

from PIL import Image

SITE = "https://pokeidle.io"
OUT = os.path.join(os.path.dirname(__file__), "..", "web", "public", "rare-icons")
CANVAS = 256       # tamanho final do PNG
FILL_RATIO = 0.82  # fração do canvas ocupada pelo lado maior do conteúdo recortado

SOURCES = {
    "boss": "/assets/site/assets/items/bronze_boss_token.png",
    "key": "/img/itens/fragmento-chave.png",
    "shinyStone": "/img/itens/shiny-stone.png",
    "bike": "/img/itens/fragmento-bicicleta.png",
}


def standardize(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    target = int(CANVAS * FILL_RATIO)
    scale = target / max(im.size)
    new_size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
    im = im.resize(new_size, Image.NEAREST)  # pixel art: sem suavizar
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(im, ((CANVAS - im.width) // 2, (CANVAS - im.height) // 2), im)
    return canvas


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for key, path in SOURCES.items():
        req = urllib.request.Request(SITE + path, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
        tmp = os.path.join(OUT, f"_{key}.src.png")
        with open(tmp, "wb") as fh:
            fh.write(data)
        out_path = os.path.join(OUT, f"{key}.png")
        standardize(Image.open(tmp)).save(out_path)
        os.remove(tmp)
        print("ok ->", key, "->", out_path)


if __name__ == "__main__":
    main()

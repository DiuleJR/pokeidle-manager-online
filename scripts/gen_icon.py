"""Gera o ícone do Pokeidle Manager: Poké Ball no tema marrom-escuro + dourado do dashboard.

A bola (vermelho/creme) fica dentro de um anel dourado com losangos, e o botão
central leva uma gema dourada. Saída em web/public: icon.svg, favicon.ico,
icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png.
Uso: python scripts/gen_icon.py
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "web", "public")
G = 512  # grade lógica

BG_TOP, BG_BOT = (46, 33, 19), (14, 10, 6)
GOLD, GOLD_LT, GOLD_DK = (200, 146, 58), (243, 192, 74), (138, 95, 34)
INK = (26, 16, 8)              # contorno / faixa da bola
RED, RED_LT = (214, 58, 34), (240, 98, 70)
CREAM, CREAM_DK = (244, 232, 204), (214, 196, 156)

CX = CY = 256
R = 142                        # raio da bola
BAND = 34                      # espessura da faixa
BTN_R, BTN_IN = 50, 36         # botão central (contorno / miolo)
SPARKS = [(256, 52), (460, 256), (256, 460), (52, 256)]  # losangos no anel


def diamond(c, r):
    x, y = c
    return [(x, y - r), (x + r, y), (x, y + r), (x - r, y)]


# gema do botão (grade 512, centrada em 256,256)
GEM_TOP = [((256, 236), (232, 256), (256, 256), GOLD_LT), ((256, 236), (280, 256), (256, 256), (255, 232, 150))]
GEM_BOT = [((232, 256), (256, 256), (256, 282), (214, 158, 52)), ((280, 256), (256, 256), (256, 282), GOLD)]


def draw(size: int, rounded: bool = True, ring_scale: float = 1.0) -> Image.Image:
    S = 4
    N = size * S
    k = N / G

    def P_(pt):
        return (((pt[0] - 256) * ring_scale + 256) * k, ((pt[1] - 256) * ring_scale + 256) * k)

    def box(r):
        return [P_((CX - r, CY - r)), P_((CX + r, CY + r))]

    def w(v):
        return max(1, int(v * k * ring_scale))

    grad = Image.linear_gradient("L").resize((N, N))
    img = Image.composite(Image.new("RGB", (N, N), BG_BOT), Image.new("RGB", (N, N), BG_TOP), grad).convert("RGBA")

    glow = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(box(178), fill=(200, 146, 58, 100))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(N * 0.06)))

    d = ImageDraw.Draw(img)
    # anel dourado duplo + losangos
    d.ellipse(box(200), outline=GOLD, width=w(20))
    d.ellipse(box(176), outline=GOLD_DK, width=w(4))
    for s in SPARKS:
        d.polygon([P_(p) for p in diamond(s, 17)], fill=GOLD_LT, outline=BG_BOT)

    # bola: metade vermelha (topo) e creme (base)
    d.pieslice(box(R), 180, 360, fill=RED)
    d.pieslice(box(R), 0, 180, fill=CREAM)
    # sombra suave na base e brilho no topo-esquerda
    shade = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    sd.pieslice(box(R), 20, 160, fill=(120, 90, 50, 70))
    sd.ellipse([P_((170, 136)), P_((232, 172))], fill=(255, 255, 255, 55))
    sd.ellipse([P_((184, 146)), P_((210, 160))], fill=(255, 255, 255, 120))
    shade = shade.filter(ImageFilter.GaussianBlur(w(3)))
    # recorta a camada ao círculo da bola
    m = Image.new("L", (N, N), 0)
    ImageDraw.Draw(m).ellipse(box(R - 2), fill=255)
    img = Image.composite(Image.alpha_composite(img, shade), img, m)
    d = ImageDraw.Draw(img)

    # faixa central e contorno
    d.rectangle([P_((CX - R, CY - BAND / 2)), P_((CX + R, CY + BAND / 2))], fill=INK)
    d.ellipse(box(R), outline=INK, width=w(12))

    # botão central com gema
    d.ellipse(box(BTN_R), fill=INK)
    d.ellipse(box(BTN_IN), fill=CREAM)
    d.ellipse(box(BTN_IN), outline=CREAM_DK, width=w(3))
    for a, b, c, col in GEM_TOP + GEM_BOT:
        d.polygon([P_(a), P_(b), P_(c)], fill=col)
    d.polygon([P_(p) for p in diamond((248, 248), 4)], fill=(255, 255, 255))

    if rounded:
        mask = Image.new("L", (N, N), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, N - 1, N - 1], radius=int(112 * k), fill=255)
        img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def svg() -> str:
    pts = lambda poly: " ".join(f"{x},{y}" for x, y in poly)  # noqa: E731
    sparks = "\n  ".join(
        f'<polygon points="{pts(diamond(s, 17))}" fill="rgb{GOLD_LT}" stroke="rgb{BG_BOT}" stroke-width="2"/>' for s in SPARKS
    )
    gem = "\n  ".join(f'<polygon points="{pts([a, b, c])}" fill="rgb{col}"/>' for a, b, c, col in GEM_TOP + GEM_BOT)
    x0, x1 = CX - R, CX + R
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb{BG_TOP}"/><stop offset="1" stop-color="rgb{BG_BOT}"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="rgb{GOLD}" stop-opacity=".4"/><stop offset="1" stop-color="rgb{GOLD}" stop-opacity="0"/></radialGradient>
    <clipPath id="ball"><circle cx="{CX}" cy="{CY}" r="{R}"/></clipPath>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="190" fill="url(#glow)"/>
  <circle cx="256" cy="256" r="200" fill="none" stroke="rgb{GOLD}" stroke-width="20"/>
  <circle cx="256" cy="256" r="176" fill="none" stroke="rgb{GOLD_DK}" stroke-width="4"/>
  {sparks}
  <g clip-path="url(#ball)">
    <path d="M{x0} {CY}A{R} {R} 0 0 1 {x1} {CY}Z" fill="rgb{RED}"/>
    <path d="M{x0} {CY}A{R} {R} 0 0 0 {x1} {CY}Z" fill="rgb{CREAM}"/>
    <ellipse cx="201" cy="154" rx="31" ry="18" fill="#fff" fill-opacity=".21"/>
    <ellipse cx="197" cy="153" rx="13" ry="7" fill="#fff" fill-opacity=".47"/>
    <rect x="{x0}" y="{CY - BAND // 2}" width="{2 * R}" height="{BAND}" fill="rgb{INK}"/>
  </g>
  <circle cx="{CX}" cy="{CY}" r="{R}" fill="none" stroke="rgb{INK}" stroke-width="12"/>
  <circle cx="{CX}" cy="{CY}" r="{BTN_R}" fill="rgb{INK}"/>
  <circle cx="{CX}" cy="{CY}" r="{BTN_IN}" fill="rgb{CREAM}" stroke="rgb{CREAM_DK}" stroke-width="3"/>
  {gem}
  <polygon points="{pts(diamond((248, 248), 4))}" fill="#fff"/>
</svg>
"""


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    draw(512).save(os.path.join(OUT, "icon-512.png"))
    draw(192).save(os.path.join(OUT, "icon-192.png"))
    draw(512, rounded=False, ring_scale=0.82).save(os.path.join(OUT, "icon-maskable-512.png"))
    draw(180, rounded=False, ring_scale=0.92).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))
    draw(256).save(os.path.join(OUT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    with open(os.path.join(OUT, "icon.svg"), "w", encoding="utf8") as fh:
        fh.write(svg())
    print("ok ->", os.path.abspath(OUT))


if __name__ == "__main__":
    main()

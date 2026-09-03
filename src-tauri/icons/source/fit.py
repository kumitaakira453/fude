# 受け取った絵（artwork.png）を macOS の作法に合わせて 1024 の PNG にする。
#
#   python3 src-tauri/icons/source/fit.py src-tauri/icons/source/artwork.png /tmp/fude.png
#   npx tauri icon /tmp/fude.png
import math
import sys

from PIL import Image, ImageDraw

# 受け取った絵を macOS の作法に合わせる。絵そのものは変えない。
#
# 1. 角丸の外側にある地色を落として、生成りの面だけを取り出す
# 2. 1024 の中の 824（周囲に約 10% の余白）へ収める
# 3. Apple の squircle（超楕円）で抜く。角丸半径一定の四角より角が素直に見える
CANVAS = 1024
BOX = 824
N = 5.0
SS = 4  # マスクは 4 倍で描いてから縮め、縁のがたつきを消す

src = Image.open(sys.argv[1]).convert("RGB")
w, h = src.size

# 四隅の色を外側の地色と見なし、そこから離れた画素の外接矩形を取る。
corner = src.getpixel((2, 2))


def near(p, q, tol=18):
    return all(abs(a - b) <= tol for a, b in zip(p, q))


px = src.load()
left, right, top, bottom = w, -1, h, -1
for y in range(h):
    for x in range(w):
        if not near(px[x, y], corner):
            if x < left:
                left = x
            if x > right:
                right = x
            if y < top:
                top = y
            if y > bottom:
                bottom = y
print(f"面の外接矩形: {left},{top} - {right},{bottom}（元 {w}x{h}）")

# 正方形に整える（絵が縦横で潰れないように長い辺へ揃える）
side = max(right - left + 1, bottom - top + 1)
cx = (left + right) / 2
cy = (top + bottom) / 2
box = (
    int(round(cx - side / 2)),
    int(round(cy - side / 2)),
    int(round(cx + side / 2)),
    int(round(cy + side / 2)),
)
field = src.crop(box).resize((BOX, BOX), Image.LANCZOS)

out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
pad = (CANVAS - BOX) // 2
out.paste(field, (pad, pad))

# 超楕円のマスク
mask = Image.new("L", (CANVAS * SS, CANVAS * SS), 0)
draw = ImageDraw.Draw(mask)
half = BOX / 2 * SS
mid = CANVAS / 2 * SS
pts = []
for i in range(1440):
    t = 2 * math.pi * i / 1440
    c, s = math.cos(t), math.sin(t)
    x = math.copysign(abs(c) ** (2 / N), c) * half
    y = math.copysign(abs(s) ** (2 / N), s) * half
    pts.append((mid + x, mid + y))
draw.polygon(pts, fill=255)
mask = mask.resize((CANVAS, CANVAS), Image.LANCZOS)

out.putalpha(mask)
out.save(sys.argv[2])
print(sys.argv[2])

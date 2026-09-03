# アイコンの元。1024 の PNG を書き出し、`npx tauri icon <png>` で全サイズを作る。
#
#   python3 src-tauri/icons/source/icon.py /tmp/mdglow-icon
#   npx tauri icon /tmp/mdglow-icon.png
#
# 図案は、向き合う二つの面と、その間から差す光。人が指摘し AI が返す往復から
# 文書が仕上がっていくことを表す。何かの絵ではないので、名前を変えても効く。
# 退くのは片方の面だけにしてある（左右対称にすると目に見える）。
# 書き出しには rsvg-convert（brew install librsvg）が必要。
import math
import subprocess
import sys

CANVAS = 1024
BOX = 824
N = 5.0


def squircle(cx: float, cy: float, half: float, steps: int = 720) -> str:
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        x = math.copysign(abs(c) ** (2 / N), c) * half
        y = math.copysign(abs(s) ** (2 / N), s) * half
        pts.append(f"{cx + x:.2f},{cy + y:.2f}")
    return "M" + "L".join(pts) + "Z"


SHAPE = squircle(CANVAS / 2, CANVAS / 2, BOX / 2)

SEAM = CANVAS * 0.5
GAP = 0.0  # 端では閉じる
BULGE = 104.0  # 中ほどで退く量（左の面だけ）
MID = CANVAS * 0.5


# 面の縁。端では閉じ、中ほどで互いに退いて光が通る。
def down(x0: float, bulge: float) -> str:
    return (
        f"L{x0:.1f},0 "
        f"C{x0:.1f},{MID * 0.55:.1f} {x0 + bulge:.1f},{MID * 0.62:.1f} {x0 + bulge:.1f},{MID:.1f} "
        f"C{x0 + bulge:.1f},{MID * 1.38:.1f} {x0:.1f},{MID * 1.45:.1f} {x0:.1f},{CANVAS:.1f} "
    )


def up(x0: float, bulge: float) -> str:
    return (
        f"L{x0:.1f},{CANVAS:.1f} "
        f"C{x0:.1f},{MID * 1.45:.1f} {x0 + bulge:.1f},{MID * 1.38:.1f} {x0 + bulge:.1f},{MID:.1f} "
        f"C{x0 + bulge:.1f},{MID * 0.62:.1f} {x0:.1f},{MID * 0.55:.1f} {x0:.1f},0 "
    )


XL = SEAM - GAP
XR = SEAM + GAP

LEFT = f"M0,0 " + down(XL, -BULGE) + f"L0,{CANVAS} Z"
RIGHT = f"M{CANVAS},{CANVAS} " + up(XR, 0.0) + f"L{CANVAS},0 Z"
LENS = f"M{XL:.1f},0 " + down(XL, -BULGE)[len(f"L{XL:.1f},0 "):] + up(XR, 0.0) + "Z"

SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">
  <defs>
    <linearGradient id="left" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#1a2429"/>
      <stop offset="1" stop-color="#0b1113"/>
    </linearGradient>
    <linearGradient id="right" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#101719"/>
      <stop offset="1" stop-color="#05080a"/>
    </linearGradient>
    <linearGradient id="core" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2aa89c" stop-opacity="0"/>
      <stop offset="0.16" stop-color="#4fd1c5" stop-opacity="0.35"/>
      <stop offset="0.38" stop-color="#9ff6ea" stop-opacity="0.95"/>
      <stop offset="0.5" stop-color="#f6fffd" stop-opacity="1"/>
      <stop offset="0.64" stop-color="#9ff6ea" stop-opacity="0.95"/>
      <stop offset="0.86" stop-color="#4fd1c5" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#2aa89c" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#4fd1c5" stop-opacity="0.5"/>
      <stop offset="0.5" stop-color="#4fd1c5" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#4fd1c5" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="44"/>
    </filter>
    <filter id="near" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="13"/>
    </filter>
    <clipPath id="shape"><path d="{SHAPE}"/></clipPath>
  </defs>
  <g clip-path="url(#shape)">
    <path d="{LEFT}" fill="url(#left)"/>
    <path d="{RIGHT}" fill="url(#right)"/>
    <ellipse cx="{SEAM}" cy="{MID}" rx="220" ry="290" fill="url(#halo)" filter="url(#soft)"/>
    <path d="{LENS}" fill="url(#core)" filter="url(#near)" opacity="0.85"/>
    <path d="{LENS}" fill="url(#core)"/>
    <path d="M{XR:.1f},{MID * 0.28:.1f} L{XR:.1f},{MID * 1.72:.1f}"
          stroke="url(#core)" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.75"/>
  </g>
</svg>
"""

out = sys.argv[1]
with open(f"{out}.svg", "w") as f:
    f.write(SVG)
subprocess.run(
    ["rsvg-convert", "-w", str(CANVAS), "-h", str(CANVAS), f"{out}.svg", "-o", f"{out}.png"],
    check=True,
)
print(f"{out}.png")

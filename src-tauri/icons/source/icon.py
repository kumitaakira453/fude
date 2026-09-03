# アイコンの元。1024 の PNG を書き出し、`npx tauri icon <png>` で全サイズを作る。
#
#   python3 src-tauri/icons/source/icon.py /tmp/mdglow-icon
#   npx tauri icon /tmp/mdglow-icon.png
#
# 図案は栞。暗がりに沈んだ地から浮かび、切り欠きの奥に光が溜まる。
# 読むための道具であること、開いた場所を覚えていることを表す。
# 書き出しには rsvg-convert（brew install librsvg）が必要。
import math
import subprocess
import sys

# 1024 の中に 824 の角丸正方形（macOS の作法）。角丸は superellipse で近似する。
CANVAS = 1024
BOX = 824
N = 5.0  # 5 前後が Apple の squircle に近い


def squircle(cx: float, cy: float, half: float, steps: int = 720) -> str:
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        x = math.copysign(abs(c) ** (2 / N), c) * half
        y = math.copysign(abs(s) ** (2 / N), s) * half
        pts.append(f"{cx + x:.2f},{cy + y:.2f}")
    return "M" + "L".join(pts) + "Z"


# 栞。上は角丸、下は V に切る。切り欠きは 16px でも残る深さにする。
RW, RH, NOTCH = 322.0, 516.0, 148.0
RX = (CANVAS - RW) / 2
RY = 262.0
TOP_R = 26.0


def ribbon() -> str:
    l, r = RX, RX + RW
    t, b = RY, RY + RH
    mid = (l + r) / 2
    return (
        f"M{l:.1f},{t + TOP_R:.1f}"
        f"Q{l:.1f},{t:.1f} {l + TOP_R:.1f},{t:.1f}"
        f"L{r - TOP_R:.1f},{t:.1f}"
        f"Q{r:.1f},{t:.1f} {r:.1f},{t + TOP_R:.1f}"
        f"L{r:.1f},{b:.1f}"
        f"L{mid:.1f},{b - NOTCH:.1f}"
        f"L{l:.1f},{b:.1f}"
        "Z"
    )


SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#121a1d"/>
      <stop offset="0.55" stop-color="#0b1113"/>
      <stop offset="1" stop-color="#06090a"/>
    </linearGradient>
    <linearGradient id="ink" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#8ffbef"/>
      <stop offset="0.22" stop-color="#4fd1c5"/>
      <stop offset="0.62" stop-color="#1f8b86"/>
      <stop offset="1" stop-color="#1c5450"/>
    </linearGradient>
    <radialGradient id="bloom" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#7ff0e4" stop-opacity="0.85"/>
      <stop offset="0.45" stop-color="#4fd1c5" stop-opacity="0.26"/>
      <stop offset="1" stop-color="#4fd1c5" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.02"/>
      <stop offset="0.7" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.16"/>
    </linearGradient>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="46"/>
    </filter>
    <clipPath id="shape">
      <path d="{squircle(CANVAS / 2, CANVAS / 2, BOX / 2)}"/>
    </clipPath>
  </defs>

  <g clip-path="url(#shape)">
    <path d="{squircle(CANVAS / 2, CANVAS / 2, BOX / 2)}" fill="url(#ground)"/>
    <!-- 光は切り欠きの奥に一箇所だけ溜める -->
    <ellipse cx="{CANVAS / 2}" cy="{RY + RH - NOTCH / 2:.1f}" rx="290" ry="215"
             fill="url(#bloom)" filter="url(#soft)"/>
    <path d="{ribbon()}" fill="url(#ink)"/>
    <!-- 左の稜線。面がマットなままでも縁が立つ -->
    <path d="M{RX + 3:.1f},{RY + TOP_R:.1f} L{RX + 3:.1f},{RY + RH - 6:.1f}"
          stroke="url(#edge)" stroke-width="6" stroke-linecap="round" fill="none"/>
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

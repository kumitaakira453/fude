// 字の幅を測る。見えている行だけを組む面（原文・CSV の表）は、組む行が
// 入れ替わるたびに横幅や列の幅が変わると送るたびにガタつくので、幅は最初に
// 全体から決めて固定する。その幅を出すのに使う。

let pen: CanvasRenderingContext2D | null | undefined;

export function measureText(text: string, font: string): number {
  if (pen === undefined) {
    try {
      pen = document.createElement("canvas").getContext("2d");
    } catch {
      pen = null;
    }
  }
  // 描き板が無いところ（試験の jsdom）では字の数から見積もる。
  if (!pen) return text.length * 8;
  pen.font = font;
  return pen.measureText(text).width;
}

// 並びのうち最も幅の広いものの幅。字の数の多い順に上位だけを測る（数万行を
// 全部測ると開くのが遅れる）。
export function widestText(texts: string[], font: string, sample = 40): number {
  const long = texts
    .map((t, i) => [t.length, i] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, sample);
  return long.reduce((m, [, i]) => Math.max(m, measureText(texts[i], font)), 0);
}

// 書体の変数（--mg-font-mono など）の今の値。
export function fontVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

import type { Size } from "./zoom";

// 寸法を持たない SVG の大きさを、書いてある値から読む。
//
// WebKit は SVG の `naturalWidth` に、置いた枠の大きさを返すことがある。
// それを元の大きさとして扱うと、窓を変えるたびに「原寸」が変わってしまう。
// 数えるのは 1 枚を開いたときだけなので、素朴に読んで足りる。

const NUMBER = /^\s*([0-9.]+)\s*(px)?\s*$/;

const attr = (text: string, name: string): string | null => {
  const found = new RegExp(`<svg[^>]*\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(text);
  return found ? found[1] : null;
};

export function svgSize(text: string): Size | null {
  const width = attr(text, "width");
  const height = attr(text, "height");
  const w = width ? NUMBER.exec(width) : null;
  const h = height ? NUMBER.exec(height) : null;
  if (w && h) return { width: Number(w[1]), height: Number(h[1]) };

  // 寸法が無い（あるいは % で書いてある）なら、見取り枠の縦横をそのまま使う。
  const view = attr(text, "viewBox");
  if (!view) return null;
  const parts = view.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [, , vw, vh] = parts;
  return vw > 0 && vh > 0 ? { width: vw, height: vh } : null;
}

// 寄せと幅を持つ画像の原文。Markdown の `![](...)` には書けないので HTML で持つ。
//
//   <p align="right"><img src="./images/図.png" alt="図" width="40%"></p>
//
// 読むのは、`<p align>` の中に `<img>` が 1 枚だけの形と、`<img>` だけの形。
// ほかの属性（class・height など）が付いたものは読まない。書き戻すときに
// 落としてしまうので、生の HTML のまま残す。

export type ImageAlign = "left" | "right";

export interface ImageHtml {
  src: string;
  alt: string;
  title: string | null;
  align: ImageAlign | null;
  // 書かれたとおりの幅。% か数値（px）。つまみで変えたときは % で書く。
  width: string | null;
}

const WRAP = /^\s*<p\s+align\s*=\s*(?:"([a-z]+)"|'([a-z]+)'|([a-z]+))\s*>\s*(<img\b[^>]*>)\s*<\/p>\s*$/i;
const ALONE = /^\s*(<img\b[^>]*>)\s*$/i;
const ATTR = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const KNOWN = new Set(["src", "alt", "title", "width"]);
const WIDTH = /^\d+(?:\.\d+)?(?:%|px)?$/;

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function readImg(tag: string): Omit<ImageHtml, "align"> | null {
  const body = tag.replace(/^<img\b/i, "").replace(/\/?>$/, "");
  const attrs = new Map<string, string>();
  for (const m of body.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (!KNOWN.has(name) || attrs.has(name)) return null;
    attrs.set(name, decode(m[2] ?? m[3] ?? m[4] ?? ""));
  }
  // 属性の形に読めない字が残っていたら（値の無い属性など）読まない。
  if (body.replace(ATTR, "").trim() !== "") return null;
  const src = attrs.get("src");
  if (!src) return null;
  const width = attrs.get("width") ?? null;
  if (width !== null && !WIDTH.test(width)) return null;
  return { src, alt: attrs.get("alt") ?? "", title: attrs.get("title") ?? null, width };
}

// 寄せと幅を持つ画像として読めるなら、その中身を返す。
export function readImageHtml(html: string): ImageHtml | null {
  const wrapped = WRAP.exec(html);
  if (wrapped) {
    const align = (wrapped[1] ?? wrapped[2] ?? wrapped[3]).toLowerCase();
    if (align !== "left" && align !== "right" && align !== "center") return null;
    const img = readImg(wrapped[4]);
    return img ? { ...img, align: align === "center" ? null : align } : null;
  }
  const alone = ALONE.exec(html);
  if (!alone) return null;
  const img = readImg(alone[1]);
  return img ? { ...img, align: null } : null;
}

// 寄せも幅も無ければ null（`![alt](src)` のまま書く）。
export function writeImageHtml(img: ImageHtml): string | null {
  if (!img.align && !img.width) return null;
  const attrs = [
    `src="${escape(img.src)}"`,
    `alt="${escape(img.alt)}"`,
    ...(img.title ? [`title="${escape(img.title)}"`] : []),
    ...(img.width ? [`width="${escape(img.width)}"`] : []),
  ].join(" ");
  const tag = `<img ${attrs}>`;
  return img.align ? `<p align="${img.align}">${tag}</p>` : tag;
}

// 描くときの幅。% はそのまま、数値は px として、どちらも本文の幅までに収める。
export function cssWidth(width: string | null): string | undefined {
  if (!width) return undefined;
  return /%$/.test(width) ? width : `${parseFloat(width)}px`;
}

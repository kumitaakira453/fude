import type { Link, Parent, Root, RootContent, Text } from "mdast";

// URL の自動リンク（GFM の autolink literal）の末尾から、全角の区切りを外す。
//
// GFM は空白か ASCII の区切りで URL を終えるので、日本語の文で URL の直後に
// 続く「）」「：」「、」などまでリンクに含めてしまう。最初の全角の区切りで
// 切り、残りはリンクの後ろの字にする。日本語の道筋（/wiki/日本 など）は
// 区切りではないので残る。
//
// 編集面は位置を頼りに原文へ書き戻すので、位置も切った所で分ける。URL は
// 改行を含まないので、同じ行の中で分ければよい。

const STOP = /[、。，．：；！？（）［］｛｝「」『』【】〈〉《》〔〕…‥・　]/;

// 書いた字そのままがリンクになったものか。[字](URL) と書いたものは字と URL が
// 一致しないので外れる。
function literal(link: Link): Text | null {
  if (link.title || link.children.length !== 1) return null;
  const only = link.children[0];
  if (only.type !== "text") return null;
  // 自動リンクの url は、書いた字そのまま（www. は http://、メールは mailto: を前に付ける）。
  const v = only.value;
  return [v, `http://${v}`, `mailto:${v}`].includes(link.url) ? only : null;
}

const scheme = (link: Link, text: string): string => {
  if (link.url.startsWith("http://") && !text.startsWith("http://")) return "http://";
  if (link.url.startsWith("mailto:") && !text.startsWith("mailto:")) return "mailto:";
  return "";
};

// 位置を同じ行の中で n 字ずらす。
function shift(
  point: { line: number; column: number; offset?: number },
  n: number,
): { line: number; column: number; offset?: number } {
  return {
    line: point.line,
    column: point.column + n,
    ...(point.offset === undefined ? {} : { offset: point.offset + n }),
  };
}

function split(link: Link, text: Text): Text | null {
  const at = text.value.search(STOP);
  if (at <= 0) return null;
  const kept = text.value.slice(0, at);
  const rest = text.value.slice(at);
  const tail: Text = { type: "text", value: rest };
  const start = text.position?.start;
  const end = text.position?.end;
  if (start && end) {
    const cut = shift(start, at);
    text.position = { start, end: cut };
    tail.position = { start: cut, end };
    if (link.position) link.position = { start: link.position.start, end: cut };
  }
  link.url = scheme(link, text.value) + kept;
  text.value = kept;
  return tail;
}

export function trimCjkAutolinks(tree: Root): Root {
  const walk = (parent: Parent) => {
    for (let i = 0; i < parent.children.length; i++) {
      const node = parent.children[i] as RootContent;
      if (node.type === "link") {
        const text = literal(node);
        const tail = text && split(node, text);
        if (tail) {
          parent.children.splice(i + 1, 0, tail);
          i++;
        }
        continue;
      }
      if ("children" in node) walk(node as Parent);
    }
  };
  walk(tree);
  return tree;
}

// 描画の側（react-markdown）に渡す形。
export function remarkCjkAutolink() {
  return (tree: Root) => {
    trimCjkAutolinks(tree);
  };
}

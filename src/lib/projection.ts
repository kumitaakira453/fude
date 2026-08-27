import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

// ブロックの生 Markdown と、画面に出るプレーンテキストの対応表を作る。
// 画面で選択された範囲からソース上の位置を割り出すために使う。
//
// パーサ構成は Markdown.tsx の描画パイプラインと揃えてある。remark-cjk-friendly は
// 閉じ記号の直後が CJK 文字のときの強調の成立条件を変えるため、構成が違うと
// 「**強調**を」のような日本語の太字でソース位置がずれる。

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(remarkMath);

// プレーンテキストとして本文が現れないノード。数式は KaTeX が別の字形に置き換え、
// 生 HTML は要素として描画され、画像・改行・脚注参照は本文を持たない。
// これらを含むブロックは文字単位の対応が保証できないので exact を false にする。
const OPAQUE = new Set([
  "inlineMath",
  "math",
  "html",
  "image",
  "break",
  "footnoteReference",
]);

// 本文をそのまま持つノード。code / inlineCode は囲み記号の内側だけが本文になる。
const LITERAL = new Set(["text", "inlineCode", "code"]);

export interface Projection {
  plain: string; // 画面に出る文字を文書順に連結したもの
  srcOffsets: number[]; // plain の 1 文字ごとの、ブロック内ソースオフセット
  srcEnd: number; // plain 末尾に対応するソースオフセット（排他）
  exact: boolean; // false のとき文字単位の対応は保証されない
}

interface MdastNode {
  type?: string;
  value?: string;
  children?: MdastNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

export function buildProjection(src: string): Projection {
  const tree = processor.parse(src) as MdastNode;
  const chunks: string[] = [];
  const srcOffsets: number[] = [];
  let exact = true;
  let srcEnd = 0;

  // value が src[from, to) をそのまま切り出したものなら 1 対 1 で対応付ける。
  const emitLiteral = (value: string, from: number, to: number): boolean => {
    const at = src.indexOf(value, from);
    if (at < 0 || at + value.length > to) return false;
    for (let i = 0; i < value.length; i++) srcOffsets.push(at + i);
    srcEnd = at + value.length;
    chunks.push(value);
    return true;
  };

  // エスケープや実体参照で長さが変わる場合は 1 文字ずつ突き合わせる。
  const emitAligned = (value: string, from: number, to: number) => {
    let j = from;
    for (let i = 0; i < value.length; i++) {
      if (src[j] !== value[i]) {
        const limit = Math.min(to, j + 16);
        let k = j + 1;
        while (k < limit && src[k] !== value[i]) k++;
        if (k < limit) j = k;
        else exact = false;
      }
      srcOffsets.push(j);
      if (j < to) j++;
    }
    srcEnd = j;
    chunks.push(value);
  };

  const walk = (node: MdastNode) => {
    if (node.type && OPAQUE.has(node.type)) {
      exact = false;
      return;
    }
    if (node.type && LITERAL.has(node.type) && typeof node.value === "string") {
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from === undefined || to === undefined) {
        exact = false;
        return;
      }
      if (!emitLiteral(node.value, from, to)) emitAligned(node.value, from, to);
      return;
    }
    node.children?.forEach(walk);
  };

  walk(tree);

  return { plain: chunks.join(""), srcOffsets, srcEnd, exact };
}

// plain 上の範囲をブロック内ソースの範囲に変換する。
export function plainToSrcRange(
  p: Projection,
  start: number,
  end: number,
): { start: number; end: number } {
  const n = p.srcOffsets.length;
  if (n === 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(start, n - 1));
  const e = Math.max(s + 1, Math.min(end, n));
  return {
    start: p.srcOffsets[s],
    end: e >= n ? p.srcEnd : p.srcOffsets[e - 1] + 1,
  };
}

// plain 上で needle を探す。hint に近い出現を選ぶので、同じ文字列が
// ブロック内に複数あっても選択位置に合った方を拾える。
export function findPlain(
  plain: string,
  needle: string,
  hint = 0,
): { start: number; end: number } | null {
  if (!needle) return null;
  let best = -1;
  for (let at = plain.indexOf(needle); at >= 0; at = plain.indexOf(needle, at + 1)) {
    if (best < 0 || Math.abs(at - hint) < Math.abs(best - hint)) best = at;
  }
  return best < 0 ? null : { start: best, end: best + needle.length };
}

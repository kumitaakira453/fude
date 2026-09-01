import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

// 本文をトップレベルのブロック（段落・見出し・リスト・表・コードフェンス等）に
// 分割する。編集は「クリックした極小のブロックだけ」を生ソース化するために使う。
// レンダリング後の高さに依存しないよう、ソースのオフセット範囲で厳密に切り出す。

export interface Block {
  index: number;
  src: string; // このブロックの生 Markdown
  start: number; // body 内のオフセット（開始）
  end: number; // body 内のオフセット（終端・排他）
  type: string; // mdast のノード種別（list / table / paragraph など）
  depth?: number; // 見出しの階層（type が heading のときだけ）
}

const processor = unified().use(remarkParse).use(remarkGfm);

interface MdastNode {
  type?: string;
  depth?: number;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

export function splitBlocks(body: string): Block[] {
  const tree = processor.parse(body) as { children: MdastNode[] };
  const blocks: Block[] = [];
  tree.children.forEach((node, index) => {
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? body.length;
    blocks.push({
      index,
      src: body.slice(start, end),
      start,
      end,
      type: node.type ?? "",
      depth: node.type === "heading" ? node.depth : undefined,
    });
  });
  return blocks;
}

// 指定したブロックが属する見出しの階層を、上位から順に返す。
// レビューの指摘に「どのセクションに対するものか」を持たせるために使う。
export function sectionPathAt(blocks: Block[], blockIndex: number): string[] {
  const stack: { depth: number; text: string }[] = [];
  for (const block of blocks) {
    if (block.index >= blockIndex) break;
    if (block.type !== "heading" || !block.depth) continue;
    while (stack.length && stack[stack.length - 1].depth >= block.depth) stack.pop();
    stack.push({ depth: block.depth, text: headingText(block.src) });
  }
  return stack.map((s) => s.text);
}

// 見出しブロックのソースから表示される文字列を取り出す。
// ATX（### 見出し）と Setext（見出し\n===）の両方を扱う。
function headingText(src: string): string {
  const firstLine = src.split("\n", 1)[0] ?? "";
  return firstLine
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/\s*#+\s*$/, "")
    .trim();
}

// ブロックの編集結果を body に差し戻す（範囲外＝ブロック間の空行等は保持）。
export function replaceBlock(body: string, block: Block, newSrc: string): string {
  return body.slice(0, block.start) + newSrc + body.slice(block.end);
}

// ---- 編集する単位の判定 ----
//
// どこを編集するかは、選択された箇所を含む「最小の単位」で決める。
// 表ならセル、箇条書きなら項目、それ以外はブロック全体。
// 画面の構造ではなくソース上の位置から決めるので、単体で試せる。

// GFM テーブルのブロックか（2 行目が区切り行 `| --- | --- |`）
export function isTableBlock(src: string): boolean {
  const lines = src.split("\n");
  return (
    lines.length >= 2 &&
    /^[\s|:-]+$/.test(lines[1]) &&
    lines[1].includes("-") &&
    lines[1].includes("|")
  );
}

export function isMermaidBlock(src: string): boolean {
  return /^\s*`{3,}\s*mermaid\b/i.test(src);
}

// 1 行を「エスケープされていない `|`」で分割する（`\|` は区切りにしない）
export function splitRow(line: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) {
      cur += ch + line[i + 1];
      i++;
      continue;
    }
    if (ch === "|") {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

// 表示上の列 index を、分割済み parts の index に変換（先頭 `|` があれば +1）
export function partIndexOf(line: string, colIndex: number): number {
  return colIndex + (/^\s*\|/.test(line) ? 1 : 0);
}

// 箇条書き項目のマーカー（インデント + - / 1. + 任意の [ ] チェックボックス）
const ITEM_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

// offset を含む 1 行から、マーカーを除いた「項目の本文」の範囲を求める。
// 子リストは別の行なので範囲に入らず、マーカーも保たれる。
export function itemTextRange(
  src: string,
  offset: number,
): { start: number; end: number } | null {
  const at = clampOffset(src, offset);
  const { lineStart, lineEnd } = lineRangeAt(src, at);
  const line = src.slice(lineStart, lineEnd);
  const marker = ITEM_MARKER_RE.exec(line);
  if (!marker) return null;
  const start = lineStart + marker[0].length;
  let end = lineEnd;
  while (end > start && /\s/.test(src[end - 1])) end--;
  return start < end ? { start, end } : null;
}

export type Unit =
  // cellStart は mdast が tableCell に付ける開始オフセット。セル編集の照合に
  // 使うので、パーサと同じ値でなければならない（そのセルの直前の `|` の位置）。
  | { kind: "cell"; lineIndex: number; colIndex: number; cellStart: number }
  | { kind: "item"; start: number; end: number }
  | { kind: "block" };

// ブロックのソースと、その中の文字位置から、編集する最小の単位を決める。
export function unitAt(src: string, offset: number): Unit {
  const at = clampOffset(src, offset);

  if (isTableBlock(src)) {
    const cell = cellAt(src, at);
    return cell ?? { kind: "block" };
  }

  const item = itemTextRange(src, at);
  if (item) return { kind: "item", start: item.start, end: item.end };

  return { kind: "block" };
}

function clampOffset(src: string, offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(Math.trunc(offset), src.length));
}

function lineRangeAt(src: string, at: number): { lineStart: number; lineEnd: number } {
  const lineStart = src.lastIndexOf("\n", at - 1) + 1;
  const nl = src.indexOf("\n", lineStart);
  return { lineStart, lineEnd: nl === -1 ? src.length : nl };
}

// 表の中の位置からセルを決める。区切り行と、列の外に落ちた位置は対象にしない。
function cellAt(src: string, at: number): Unit | null {
  const lines = src.split("\n");
  const { lineStart, lineEnd } = lineRangeAt(src, at);
  const lineIndex = src.slice(0, lineStart).split("\n").length - 1;
  // 2 行目は区切り行。ここを選んでも編集するものが無い。
  if (lineIndex === 1) return null;
  const line = src.slice(lineStart, lineEnd);
  if (!line.includes("|")) return null;

  // 行の中のエスケープされていない `|` の位置を集める。位置より前にある数が
  // parts の index になり、その 1 つ手前の `|` がセルの開始になる。
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "|") pipes.push(i);
  }
  const inLine = at - lineStart;
  const partIndex = pipes.filter((i) => i < inLine).length;

  const parts = splitRow(line);
  // 先頭の `|` より前は列に属さない。
  const colIndex = partIndex - (/^\s*\|/.test(line) ? 1 : 0);
  if (colIndex < 0) return null;
  const part = partIndexOf(line, colIndex);
  if (part >= parts.length) return null;
  // 末尾の `|` より後ろ（空の part）はセルではない。
  if (parts[part].trim() === "" && part === parts.length - 1) return null;
  if (lineIndex >= lines.length) return null;
  const pipe = pipes[part - 1];
  const cellStart = lineStart + (pipe === undefined ? 0 : pipe);
  return { kind: "cell", lineIndex, colIndex, cellStart };
}

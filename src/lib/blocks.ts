import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  buildProjection,
  findPlain,
  findPlainLoose,
  plainToSrcRange,
} from "./projection";

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

// ---- 書き換わった周りだけ parse し直す ----
//
// body 全体の parse は 65,000 字で 200ms 超かかる。1 ブロック消すたびに
// これを払うと、消えるまでに間があく。変わっていない範囲のブロックは
// そのまま使い回し、書き換わったところの周りだけ parse する。
//
// 局所 parse が全文 parse と食い違う形（境界の取り方で結果が変わる形）では
// 使い回しをやめて全文 parse に落とす。速さのために結果を変えない。

// 空行を挟んでも次の塊と 1 つに繋がりうるブロック。緩いリスト・字下げの
// コードブロック・閉じタグまで続く HTML が該当する。境界に来たら、その
// ブロックごと parse し直す（隣を見ずに切ると分かれ方が変わる）。
function mergeable(block: Block): boolean {
  if (block.type === "list" || block.type === "html") return true;
  return block.type === "code" && !/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(block.src);
}

// その位置の直後が空行で始まっているか（そこから後ろを別の塊として読めるか）。
function blankAfter(body: string, at: number): boolean {
  return /^[ \t]*\r?\n[ \t]*\r?\n/.test(body.slice(at, at + 64));
}

// その位置の直前が空行で終わっているか。
function blankBefore(body: string, at: number): boolean {
  return /\r?\n[ \t]*\r?\n[ \t]*$/.test(body.slice(Math.max(0, at - 64), at));
}

// 閉じていないコードフェンスは空行では終わらず、後ろの塊まで飲み込む。
// 窓の中でフェンスの数が合わないときは、窓の外まで影響するので落とす。
function fencesBalanced(text: string): boolean {
  const opens = text.match(/^[ \t]{0,3}(?:`{3,}|~{3,})/gm);
  return !opens || opens.length % 2 === 0;
}

export function resplitBlocks(
  oldBody: string,
  oldBlocks: Block[],
  newBody: string,
): Block[] {
  if (oldBody === newBody) return oldBlocks;
  if (oldBlocks.length === 0) return splitBlocks(newBody);

  // 変わっていない前後の長さ
  const shorter = Math.min(oldBody.length, newBody.length);
  let head = 0;
  while (head < shorter && oldBody[head] === newBody[head]) head++;
  let tail = 0;
  while (
    tail < shorter - head &&
    oldBody[oldBody.length - 1 - tail] === newBody[newBody.length - 1 - tail]
  )
    tail++;

  const delta = newBody.length - oldBody.length;
  const changedEnd = oldBody.length - tail;

  // 使い回す候補。前は書き換わりより手前で終わるもの、後は書き換わりより
  // 後ろで始まるもの。前側は位置が変わらず、後側は差分だけずれる。
  let before = 0;
  while (before < oldBlocks.length && oldBlocks[before].end <= head) before++;
  let after = oldBlocks.length;
  while (after > before && oldBlocks[after - 1].start >= changedEnd) after--;

  // 境界を安全なところまで下げる。空行で切れていない、または繋がりうる形の
  // ブロックが境界に来ているあいだ、窓を広げる。
  while (before > 0) {
    const edge = oldBlocks[before - 1];
    if (!mergeable(edge) && blankAfter(newBody, edge.end)) break;
    before--;
  }
  while (after < oldBlocks.length) {
    const edge = oldBlocks[after];
    if (!mergeable(edge) && blankBefore(newBody, edge.start + delta)) break;
    after++;
  }
  if (after < before) return splitBlocks(newBody);

  const from = before > 0 ? oldBlocks[before - 1].end : 0;
  const to = after < oldBlocks.length ? oldBlocks[after].start + delta : newBody.length;
  if (to < from) return splitBlocks(newBody);

  const window = newBody.slice(from, to);
  if (!fencesBalanced(window)) return splitBlocks(newBody);

  const blocks: Block[] = [];
  for (let i = 0; i < before; i++) blocks.push(oldBlocks[i]);
  for (const b of splitBlocks(window)) {
    blocks.push({ ...b, index: blocks.length, start: b.start + from, end: b.end + from });
  }
  for (let i = after; i < oldBlocks.length; i++) {
    const b = oldBlocks[i];
    blocks.push({ ...b, index: blocks.length, start: b.start + delta, end: b.end + delta });
  }

  // 位置が食い違っていたら使い回しを捨てる（切り出しがずれた指摘や編集は
  // 別の場所を書き換えてしまう）。
  for (const b of blocks) {
    if (b.start > b.end || newBody.slice(b.start, b.end) !== b.src) {
      return splitBlocks(newBody);
    }
  }
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

// ---- ブロックの並べ替えと差し込み ----
//
// 本文を「隙間 + ブロック本体」の並びとして扱う。隙間は後ろのブロックに付いて動く。
// ブロック本体を組み直さないので、動かしていない箇所の文字は 1 つも変わらない。

interface Piece {
  gap: string;
  src: string;
}

function piecesOf(
  body: string,
  blocks: Block[],
): { pieces: Piece[]; tail: string } {
  const pieces: Piece[] = [];
  let at = 0;
  for (const b of blocks) {
    pieces.push({ gap: body.slice(at, b.start), src: b.src });
    at = b.end;
  }
  return { pieces, tail: body.slice(at) };
}

// ブロックの間には空行が要る。隙間を失ったものには補う。
function separator(gap: string): string {
  return /\n[ \t]*\n/.test(gap) ? gap : "\n\n";
}

// from のブロックを、元の並びで to の直前へ動かす。to が末尾なら blocks.length。
export function moveBlock(
  body: string,
  blocks: Block[],
  from: number,
  to: number,
): string {
  if (from < 0 || from >= blocks.length) return body;
  if (to < 0 || to > blocks.length) return body;
  if (to === from || to === from + 1) return body;

  const { pieces, tail } = piecesOf(body, blocks);
  // 先頭の隙間はファイルの書き出し。動かすブロックに付いて回らせない。
  const lead = pieces[0]?.gap ?? "";
  const [moved] = pieces.splice(from, 1);
  pieces.splice(to > from ? to - 1 : to, 0, moved);
  return (
    pieces
      .map((p, i) => (i === 0 ? lead : separator(p.gap)) + p.src)
      .join("") + tail
  );
}

// ブロックの並べ替えで、別のブロックの位置がどこへ移るか。
export function remapAfterMove(i: number, from: number, to: number): number {
  const landed = to > from ? to - 1 : to;
  if (i === from) return landed;
  if (i > from && i <= landed) return i - 1;
  if (i >= landed && i < from) return i + 1;
  return i;
}

// 範囲を取り除く。継ぎ目の空行を畳んで、跡地に大きな隙間を残さない。
function cutSpan(body: string, start: number, end: number): string {
  const before = body.slice(0, start).replace(/\n+$/, "");
  const after = body.slice(end).replace(/^\n+/, "");
  return before && after ? `${before}\n\n${after}` : before + after;
}

// ブロックを取り除く。
export function cutBlock(body: string, block: Block): string {
  return cutSpan(body, block.start, block.end);
}

// 複数のブロックにまたがる範囲の生ソース。選択がまたいだときは、この範囲を
// 1 枚のエディタで直す（ブロックごとに開くと、またいだ選択と食い違う）。
export function spanSrc(body: string, from: Block, to: Block): string {
  return body.slice(from.start, to.end);
}

// その範囲を書き換えた結果を本文へ戻す。空にしたら範囲ごと取り除く。
export function replaceSpan(
  body: string,
  from: Block,
  to: Block,
  newSrc: string,
): string {
  if (newSrc.trim() === "") return cutSpan(body, from.start, to.end);
  return body.slice(0, from.start) + newSrc + body.slice(to.end);
}

export function insertAfter(body: string, block: Block, src: string): string {
  return `${body.slice(0, block.end)}\n\n${src}${body.slice(block.end)}`;
}

export function insertBefore(body: string, block: Block, src: string): string {
  return `${body.slice(0, block.start)}${src}\n\n${body.slice(block.start)}`;
}

// ---- 表の並べ替え ----
//
// 行は「0 行目=見出し / 1 行目=区切り / 2 行目以降=本体」。動かせるのは本体だけ。
// 列は全ての行を割って入れ替える。区切り行の寄せ（:---:）も一緒に動く。
// どちらも to は「動かす前の並びで、どの位置の前に置くか」。

export function moveTableRow(src: string, from: number, to: number): string {
  const lines = src.split("\n");
  if (from < 2 || from >= lines.length) return src;
  if (to < 2 || to > lines.length) return src;
  if (to === from || to === from + 1) return src;
  const [row] = lines.splice(from, 1);
  lines.splice(to > from ? to - 1 : to, 0, row);
  return lines.join("\n");
}

// その行が持つセルの数。先頭と末尾の | は数に入れない。
function cellCount(line: string): number {
  const parts = splitRow(line);
  const lead = /^\s*\|/.test(line) ? 1 : 0;
  const tail =
    parts.length > 1 && parts[parts.length - 1].trim() === "" ? 1 : 0;
  return parts.length - lead - tail;
}

export function moveTableColumn(src: string, from: number, to: number): string {
  if (from < 0 || to < 0 || to === from || to === from + 1) return src;
  return src
    .split("\n")
    .map((line) => {
      // 列が足りない行（欠けた行）は触らない。
      const cols = cellCount(line);
      if (from >= cols || to > cols) return line;
      const parts = splitRow(line);
      const f = partIndexOf(line, from);
      const t = partIndexOf(line, to);
      const [cell] = parts.splice(f, 1);
      parts.splice(t > f ? t - 1 : t, 0, cell);
      return parts.join("|");
    })
    .join("\n");
}

// 行の中でセルとして扱う範囲。先頭と末尾の | は含めない。
function cellSpan(line: string, parts: string[]): { from: number; to: number } {
  const lead = /^\s*\|/.test(line) ? 1 : 0;
  const tail =
    parts.length > 1 && parts[parts.length - 1].trim() === ""
      ? parts.length - 1
      : parts.length;
  return { from: lead, to: tail };
}

// 空の行を差し込む。at は行番号（2 以上）。末尾に足すなら行数を渡す。
export function insertTableRow(src: string, at: number): string {
  const lines = src.split("\n");
  if (lines.length < 2 || at < 2 || at > lines.length) return src;
  const cols = cellCount(lines[0]);
  if (cols < 1) return src;
  const lead = /^\s*\|/.test(lines[0]);
  const body = Array.from({ length: cols }, () => "  ").join("|");
  lines.splice(at, 0, lead ? `|${body}|` : body);
  return lines.join("\n");
}

// 空の列を差し込む。at は列番号。末尾に足すなら列数を渡す。
export function insertTableColumn(src: string, at: number): string {
  const lines = src.split("\n");
  if (lines.length < 2 || at < 0 || at > cellCount(lines[0])) return src;
  return lines
    .map((line, i) => {
      const parts = splitRow(line);
      parts.splice(partIndexOf(line, at), 0, i === 1 ? " --- " : "  ");
      return parts.join("|");
    })
    .join("\n");
}

export function appendTableRow(src: string): string {
  return insertTableRow(src, src.split("\n").length);
}

export function appendTableColumn(src: string): string {
  return insertTableColumn(src, cellCount(src.split("\n")[0] ?? ""));
}

// 行を真下に複製する。
export function duplicateTableRow(src: string, line: number): string {
  const lines = src.split("\n");
  if (line < 2 || line >= lines.length) return src;
  lines.splice(line + 1, 0, lines[line]);
  return lines.join("\n");
}

// 列を右隣に複製する。
export function duplicateTableColumn(src: string, col: number): string {
  const lines = src.split("\n");
  if (lines.length < 2 || col < 0 || col >= cellCount(lines[0])) return src;
  return lines
    .map((line) => {
      if (col >= cellCount(line)) return line;
      const parts = splitRow(line);
      const at = partIndexOf(line, col);
      parts.splice(at + 1, 0, parts[at]);
      return parts.join("|");
    })
    .join("\n");
}

// 行の中身を空にする。行そのものは残す。
export function clearTableRow(src: string, line: number): string {
  const lines = src.split("\n");
  if (line < 2 || line >= lines.length) return src;
  const parts = splitRow(lines[line]);
  const span = cellSpan(lines[line], parts);
  for (let i = span.from; i < span.to; i++) parts[i] = "  ";
  lines[line] = parts.join("|");
  return lines.join("\n");
}

// 列の中身を空にする。見出しは列の名前なので残す。
export function clearTableColumn(src: string, col: number): string {
  const lines = src.split("\n");
  if (lines.length < 2 || col < 0) return src;
  return lines
    .map((line, i) => {
      if (i <= 1 || col >= cellCount(line)) return line;
      const parts = splitRow(line);
      parts[partIndexOf(line, col)] = "  ";
      return parts.join("|");
    })
    .join("\n");
}

// 表から行を取り除く。見出しと区切りは消せない。
export function deleteTableRow(src: string, line: number): string {
  const lines = src.split("\n");
  if (line < 2 || line >= lines.length) return src;
  lines.splice(line, 1);
  return lines.join("\n");
}

// 表から列を取り除く。最後の 1 列は残す（表でなくなってしまう）。
export function deleteTableColumn(src: string, col: number): string {
  const lines = src.split("\n");
  if (lines.length < 2 || col < 0) return src;
  if (cellCount(lines[0]) <= 1) return src;
  return lines
    .map((line) => {
      if (col >= cellCount(line)) return line;
      const parts = splitRow(line);
      parts.splice(partIndexOf(line, col), 1);
      return parts.join("|");
    })
    .join("\n");
}

// ---- 箇条書きの項目 ----
//
// Markdown ではリスト全体が 1 つのブロックだが、書く側の感覚では項目ごとが
// 1 つのまとまり。項目を行の範囲として扱い、移動・削除・複製・差し込みを
// この単位で行う。子（より深い項目）は親の範囲に含める。

const MARKER = /^(\s*)(?:[-*+]|\d+[.)])\s/;

export interface ItemRange {
  from: number; // 記号がある行
  to: number; // 次の項目が始まる行（排他）
  indent: number;
}

export function listItemRanges(src: string): ItemRange[] {
  const lines = src.split("\n");
  const heads: { line: number; indent: number }[] = [];
  lines.forEach((line, i) => {
    const m = MARKER.exec(line);
    if (m) heads.push({ line: i, indent: m[1].length });
  });
  return heads.map((head, k) => {
    let to = lines.length;
    for (let j = k + 1; j < heads.length; j++) {
      if (heads[j].indent <= head.indent) {
        to = heads[j].line;
        break;
      }
    }
    return { from: head.line, to, indent: head.indent };
  });
}

// その位置を含む項目。入れ子なら内側の（いちばん深い）ものを返す。
export function listItemAt(src: string, offset: number): ItemRange | null {
  const at = clampOffset(src, offset);
  const line = src.slice(0, at).split("\n").length - 1;
  let hit: ItemRange | null = null;
  for (const r of listItemRanges(src)) {
    if (line >= r.from && line < r.to && (!hit || r.from > hit.from)) hit = r;
  }
  return hit;
}

// 項目を動かす。from / to は記号がある行番号。to は末尾なら行数。
// 深さが違う相手の間には動かさない（構造が崩れる）。
export function moveListItem(src: string, from: number, to: number): string {
  const lines = src.split("\n");
  const ranges = listItemRanges(src);
  const moved = ranges.find((r) => r.from === from);
  if (!moved) return src;
  if (to === moved.from || to === moved.to) return src;
  if (to !== lines.length) {
    const target = ranges.find((r) => r.from === to);
    if (!target || target.indent !== moved.indent) return src;
  }
  const chunk = lines.slice(moved.from, moved.to);
  const rest = [...lines.slice(0, moved.from), ...lines.slice(moved.to)];
  const at = to > moved.from ? to - chunk.length : to;
  rest.splice(at, 0, ...chunk);
  return rest.join("\n");
}

export function deleteListItem(src: string, from: number): string {
  const ranges = listItemRanges(src);
  const item = ranges.find((r) => r.from === from);
  if (!item || ranges.length <= 1) return src;
  const lines = src.split("\n");
  lines.splice(item.from, item.to - item.from);
  return lines.join("\n");
}

export function duplicateListItem(src: string, from: number): string {
  const item = listItemRanges(src).find((r) => r.from === from);
  if (!item) return src;
  const lines = src.split("\n");
  lines.splice(item.to, 0, ...lines.slice(item.from, item.to));
  return lines.join("\n");
}

// 空の項目を差し込む。記号と深さは基準の項目に合わせる。
// 戻り値には差し込んだ行番号も返す（そのまま書き始められるようにする）。
export function insertListItem(
  src: string,
  from: number,
  side: "before" | "after",
): { src: string; line: number } | null {
  const item = listItemRanges(src).find((r) => r.from === from);
  if (!item) return null;
  const lines = src.split("\n");
  const head = MARKER.exec(lines[item.from]);
  if (!head) return null;
  const marker = lines[item.from].slice(0, head[0].length);
  const line = side === "after" ? item.to : item.from;
  lines.splice(line, 0, marker);
  return { src: lines.join("\n"), line };
}

// 記号そのものの位置。描画側が li の目印に載せる値（mdast の listItem の
// 開始位置）と同じで、差し込んだ項目を開くときの照合に使う。
export function itemMarkerAt(src: string, line: number): number | null {
  const lines = src.split("\n");
  if (line < 0 || line >= lines.length) return null;
  const head = MARKER.exec(lines[line]);
  if (!head) return null;
  let at = 0;
  for (let i = 0; i < line; i++) at += lines[i].length + 1;
  return at + head[1].length;
}

// 項目の本文が始まる位置。差し込んだ項目をすぐ書けるようにするために使う。
export function itemTextStart(src: string, line: number): number | null {
  const lines = src.split("\n");
  if (line < 0 || line >= lines.length) return null;
  const head = MARKER.exec(lines[line]);
  if (!head) return null;
  let at = 0;
  for (let i = 0; i < line; i++) at += lines[i].length + 1;
  return at + head[0].length;
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

// セルの開始位置から行と列を引く。mdast はセルの開始を「直前の | の位置」で
// 付けるので、それをそのまま位置として読むと 1 つ手前の列に当たる。区切りの
// 内側へ 1 文字進めてから数える。
// 行番号と列番号からセルの開始位置を出す。値は描画側が目印に載せるものと
// 同じ（直前の | の位置）。空のセルを開くときに使う。
export function cellStartAt(
  src: string,
  lineIndex: number,
  colIndex: number,
): number | null {
  const lines = src.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return null;
  let lineStart = 0;
  for (let i = 0; i < lineIndex; i++) lineStart += lines[i].length + 1;
  const line = lines[lineIndex];
  const parts = splitRow(line);
  const idx = partIndexOf(line, colIndex);
  if (idx < 0 || idx >= parts.length) return null;
  if (idx === 0) return lineStart;
  let at = 0;
  for (let i = 0; i < idx; i++) at += parts[i].length + 1;
  return lineStart + at - 1;
}

export type CellUnit = Extract<Unit, { kind: "cell" }>;

export function cellFromStart(src: string, cellStart: number): CellUnit | null {
  const unit = unitAt(src, cellStart + 1);
  return unit.kind === "cell" ? unit : null;
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

// 行の中のセルの文字。前後の余白は落とす。
export function cellValueAt(
  src: string,
  lineIndex: number,
  colIndex: number,
): string {
  const line = src.split("\n")[lineIndex] ?? "";
  return (splitRow(line)[partIndexOf(line, colIndex)] ?? "").trim();
}

// セルの文字を差し替える。区切りの内側に余白を残して読みやすさを保つ。
export function setCellValue(
  src: string,
  lineIndex: number,
  colIndex: number,
  value: string,
): string {
  const lines = src.split("\n");
  const line = lines[lineIndex];
  if (line === undefined) return src;
  const parts = splitRow(line);
  const idx = partIndexOf(line, colIndex);
  if (idx < 0 || idx >= parts.length) return src;
  const t = value.trim();
  parts[idx] = t ? ` ${t} ` : "  ";
  lines[lineIndex] = parts.join("|");
  return lines.join("\n");
}

// ---- 画面で選択した箇所を消す ----
//
// 画面に出ている文字とソースの対応表（projection）で位置を出し、ソースから
// 取り除く。単位の中身が残らなくなったら、器（`## ` や空のコールアウト）は
// 残さずその単位ごと取り除く。

// 中身を丸ごと覆ったときに一緒に落とす囲み。長い順に見る（`**` を `*` として
// 読むと片方だけ残る）。
const WRAPS = ["***", "**", "__", "~~", "*", "_", "`"];

// 行の書き出しの記号だけ（見出し・箇条書き・引用）。
const SYNTAX_ONLY = /^[ \t]*(?:#{1,6}|[-*+]|\d+[.)]|>)?[ \t]*$/;

// src の [start, end) を取り除く。囲みで挟まれているあいだは外へ広げる。
function cutRange(src: string, start: number, end: number): string {
  let from = start;
  let to = end;
  for (;;) {
    const wrap = WRAPS.find(
      (w) =>
        from >= w.length &&
        src.startsWith(w, from - w.length) &&
        src.startsWith(w, to),
    );
    if (wrap) {
      from -= wrap.length;
      to += wrap.length;
      continue;
    }
    // リンクの文字を丸ごと覆っていたら宛先ごと落とす（`[](url)` を残さない）。
    if (from > 0 && src[from - 1] === "[" && src.startsWith("](", to)) {
      const close = src.indexOf(")", to + 2);
      if (close > to) {
        from -= 1;
        to = close + 1;
        if (from > 0 && src[from - 1] === "!") from -= 1;
        continue;
      }
    }
    break;
  }
  // 両側を空白で挟まれていたら片方も落とす（二重の空きを残さない）。
  if (from > 0 && /[ \t]/.test(src[from - 1]) && /[ \t]/.test(src[to] ?? "")) {
    to += 1;
  }
  // 行末に取り残される空白も落とす。ただし記号だけが残る行では、記号との
  // 間の空白を保つ（`## ` を `##` にすると見出しでなくなる）。
  if (to >= src.length || src[to] === "\n") {
    const lineStart = src.lastIndexOf("\n", from - 1) + 1;
    let trimmed = from;
    while (trimmed > lineStart && /[ \t]/.test(src[trimmed - 1])) trimmed--;
    if (!SYNTAX_ONLY.test(src.slice(lineStart, trimmed))) from = trimmed;
  }
  return src.slice(0, from) + src.slice(to);
}

// hint に近い出現を選ぶ。同じ文字列が複数あっても選んだ場所の方を拾う。
function nearestIndexOf(src: string, text: string, hint: number): number {
  let best = -1;
  for (let at = src.indexOf(text); at >= 0; at = src.indexOf(text, at + 1)) {
    if (best < 0 || Math.abs(at - hint) < Math.abs(best - hint)) best = at;
  }
  return best;
}

// 画面に出ている文字列を、ソースから 1 か所取り除く。
function cutText(src: string, text: string, hint: number): string | null {
  const p = buildProjection(src);
  if (p.exact) {
    const at = findPlain(p.plain, text, hint) ?? findPlainLoose(p.plain, text);
    if (at) {
      const range = plainToSrcRange(p, at.start, at.end);
      return cutRange(src, range.start, range.end);
    }
  }
  // 対応表に文字が出ない塊（生 HTML など）は、ソースを直に探す。
  const raw = nearestIndexOf(src, text, hint);
  return raw < 0 ? null : cutRange(src, raw, raw + text.length);
}

// 文字が残っているか。生 HTML の塊は対応表に中身が出ないのでタグを外して見る。
function hasText(src: string): boolean {
  if (/^\s*</.test(src)) return src.replace(/<[^>]*>/g, "").trim() !== "";
  return buildProjection(src).plain.trim() !== "";
}

export interface Cut {
  body: string;
  // ブロックが 1 つ減ったか（以降のブロック番号がずれる）。
  shift: boolean;
}

// 書き換えたブロックを本文へ戻す。文字が残らなくなったら器ごと取り除く。
function settle(body: string, block: Block, next: string): Cut | null {
  if (next === block.src) return null;
  if (hasText(block.src) && !hasText(next)) {
    return { body: cutBlock(body, block), shift: true };
  }
  return { body: replaceBlock(body, block, next), shift: false };
}

export function cutSelection(
  body: string,
  block: Block,
  sel: {
    start: number;
    text: string;
    cellStart?: number;
    itemAnchor?: number;
  },
): Cut | null {
  const src = block.src;
  // 図は生ソースを触らせない（描けなくなる）。
  if (isMermaidBlock(src)) return null;

  // 表はセルの中身だけ。行と列はつまみから消せる。ソースを直に切ると
  // `|` まで消えて表が崩れるので、セルをまたぐ選択は受け取らない。
  if (isTableBlock(src)) {
    if (sel.cellStart === undefined) return null;
    const cell = cellFromStart(src, sel.cellStart);
    if (!cell) return null;
    const value = cellValueAt(src, cell.lineIndex, cell.colIndex);
    const next = cutText(value, sel.text, 0);
    if (next === null || next === value) return null;
    const src2 = setCellValue(src, cell.lineIndex, cell.colIndex, next);
    return src2 === src ? null : { body: replaceBlock(body, block, src2), shift: false };
  }

  // 箇条書きは項目の中で消す。中身が空になった項目は記号だけ残さない。
  if (sel.itemAnchor !== undefined) {
    const range = itemTextRange(src, sel.itemAnchor);
    if (range) {
      const text = src.slice(range.start, range.end);
      const next = cutText(text, sel.text, 0);
      if (next === null) return null;
      const spliced = src.slice(0, range.start) + next + src.slice(range.end);
      if (next.trim() !== "") return settle(body, block, spliced);
      const item = listItemAt(src, sel.itemAnchor);
      const dropped = item ? deleteListItem(src, item.from) : src;
      // 項目が 1 つだけのリストは取り除けない。そのときは空の項目のまま
      // 渡して、リストごと消える方に任せる。
      return settle(body, block, dropped === src ? spliced : dropped);
    }
  }

  const next = cutText(src, sel.text, sel.start);
  return next === null ? null : settle(body, block, next);
}

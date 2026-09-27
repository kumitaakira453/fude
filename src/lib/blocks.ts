import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  commonIndent,
  containerSpans,
  lostList,
  unpadLines,
  type ContainerKind,
} from "./htmlSpans";
import { DONE, flipped, taskMarks } from "./md/taskMarks";

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

// 囲みの範囲を先に行で決めてから、囲みでない区間だけを parse する。
//
// 囲みを CommonMark に任せると、`</details>` の後ろの本文が同じ塊に飲み込まれ
// たり（空行が無い書き方）、囲みの途中で割れて開きだけ・中身だけ・閉じだけに
// 散ったりする。読む側はブロックごとに描くので、割れると折りたためない。
export function splitBlocks(body: string): Block[] {
  // 位置は常に本文の上の位置で持つ。字下げを落として読み直した区間も、
  // 戻した位置で持つ（生ソースの編集と指摘の居場所がここに乗る）。
  const at = (start: number, end: number, type: string, depth?: number): Part => ({
    src: body.slice(start, end),
    start,
    end,
    type,
    depth,
  });

  // 字下げを落として読み直した区間では、落とした分だけ頭が内側にずれる。
  // ブロックの頭は行の頭に戻し、原文の字下げごと持たせる。
  const lineStart = (o: number) => body.lastIndexOf("\n", o - 1) + 1;

  const parts = (text: string, map: (o: number) => number, snap = false): Part[] => {
    const head = (o: number) => (snap ? lineStart(map(o)) : map(o));
    const out: Part[] = [];
    for (const piece of pieces(text)) {
      if (piece.kind) {
        out.push(at(head(piece.start), map(piece.end), "html"));
        continue;
      }
      const slice = text.slice(piece.start, piece.end);
      const tree = processor.parse(slice) as { children: MdastNode[] };
      for (const node of tree.children) {
        const from = piece.start + (node.position?.start.offset ?? 0);
        const to = piece.start + (node.position?.end.offset ?? slice.length);
        const src = text.slice(from, to);
        // 親の項目を失った一覧は、字下げを落として読み直す。
        const cut =
          node.type === "code" && lostList(src)
            ? unpadLines(src, commonIndent(src.split("\n")))
            : null;
        if (cut) {
          out.push(...parts(cut.text, (o) => map(from + cut.back(o)), true));
          continue;
        }
        out.push(
          at(
            head(from),
            map(to),
            node.type ?? "",
            node.type === "heading" ? node.depth : undefined,
          ),
        );
      }
    }
    return out;
  };

  return parts(body, (o) => o).map((part, index) => ({ ...part, index }));
}

type Part = Omit<Block, "index">;

// 囲みの範囲とその隙間に切り分ける。
function pieces(
  text: string,
): { start: number; end: number; kind: ContainerKind | null }[] {
  const out: { start: number; end: number; kind: ContainerKind | null }[] = [];
  let at = 0;
  for (const span of containerSpans(text)) {
    if (span.start > at) out.push({ start: at, end: span.start, kind: null });
    out.push({ start: span.start, end: span.end, kind: span.kind });
    at = span.end;
  }
  if (at < text.length) out.push({ start: at, end: text.length, kind: null });
  return out;
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
  if (block.type === "footnoteDefinition") return true;
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

// 隣り合う 2 つのブロックが、繋げて読んでも 2 つに割れるか。
function seamHolds(
  body: string,
  a: Block | undefined,
  b: Block | undefined,
): boolean {
  if (!a || !b) return true;
  return splitBlocks(body.slice(a.start, b.end)).length === 2;
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
  const middle = splitBlocks(window);
  for (const b of middle) {
    blocks.push({ ...b, index: blocks.length, start: b.start + from, end: b.end + from });
  }
  for (let i = after; i < oldBlocks.length; i++) {
    const b = oldBlocks[i];
    blocks.push({ ...b, index: blocks.length, start: b.start + delta, end: b.end + delta });
  }

  // 継ぎ目を実際に読ませて確かめる。繋げると 1 つになる形（空行を挟んでも
  // 続くリストなど）を跨いで使い回すと、全文 parse と割り方が変わる。
  // 割り方が変わると、指摘が別のブロックを指す。
  const beforeSeam = blocks[before - 1];
  const firstInWindow = blocks[before];
  const lastInWindow = blocks[before + middle.length - 1];
  const afterSeam = blocks[before + middle.length];
  if (
    !seamHolds(newBody, beforeSeam, firstInWindow) ||
    !seamHolds(newBody, lastInWindow, afterSeam)
  ) {
    return splitBlocks(newBody);
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

// 本文の割り方は 1 か所で持つ。読む側ごとに割り直すと、表示（DOM のブロック
// 番号）と指摘の保存（どのブロックの生ソースか）で割り方が食い違い、指摘が
// 別の場所を指すことがある。同じ本文には必ず同じ配列を返す。
const recent: { body: string; blocks: Block[] }[] = [];
const KEEP = 4;

// ブロックがファイルの何行目から何行目か（1 始まり）。指摘の居場所を人と
// エージェントに渡すのに使う。shift はフロントマターの行数で、本文の頭が
// ファイルの何行目から始まるかを足すためのもの。
export function lineRange(
  body: string,
  block: Block,
  shift = 0,
): { from: number; to: number } {
  const before = countLines(body.slice(0, block.start));
  const inside = countLines(body.slice(block.start, block.end).replace(/\n+$/, ""));
  const from = shift + before + 1;
  return { from, to: from + inside };
}

function countLines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}

export function blocksOf(body: string): Block[] {
  const hit = recent.find((r) => r.body === body);
  if (hit) return hit.blocks;
  const base = recent[0];
  const blocks = base
    ? resplitBlocks(base.body, base.blocks, body)
    : splitBlocks(body);
  recent.unshift({ body, blocks });
  if (recent.length > KEEP) recent.pop();
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

// 印は設定で増える（`[/]` 進行中・`[-]` 取りやめ など）。有効なものだけを
// 見るので、切ってある印の行は今までどおり素の字として扱う。
const taskRe = (): RegExp =>
  new RegExp(
    `^(\\s*(?:[-*+]|\\d+[.)])\\s+\\[)([${taskMarks()
      .concat("X")
      .map((c) => c.replace(/[\\\]^-]/g, "\\$&"))
      .join("")}])(\\](?=[ \\t]|$))`,
  );

const put = (line: string, mark: string): string => {
  const re = taskRe();
  if (re.test(line)) {
    return line.replace(re, (_m, head: string, _mark: string, close: string) =>
      head + mark + close,
    );
  }
  // 印の無い項目に選んだときは書き足す。素の点からタスクへ、一手で移れる。
  const head = MARKER.exec(line);
  return head
    ? `${line.slice(0, head[0].length)}[${mark}] ${line.slice(head[0].length)}`
    : line;
};

const flip = (line: string): string => {
  const mark = taskRe().exec(line)?.[2];
  if (mark === undefined) return line;
  return put(line, flipped(mark === "X" ? DONE : mark));
};

// 指定した位置を含む行のタスクの印を入れ替える。その行にタスクが無ければ null。
//
// 位置は描画側が項目に載せた目印（itemMarkerAt と同じ、mdast の listItem の
// 開始位置）。行を数え上げると、GFM がタスクとして描かない "- [ ] "
// （コード例の中の行や、"]" の後ろに空白が無い行）を 1 つ数えた時点で、
// 以降の項目がまとめてずれる。
export function toggleTaskAt(src: string, at: number): string | null {
  return rewriteTaskAt(src, at, flip);
}

function rewriteTaskAt(
  src: string,
  at: number,
  change: (line: string) => string,
): string | null {
  if (at < 0 || at > src.length) return null;
  const lines = src.split("\n");
  let start = 0;
  for (const line of lines) {
    const end = start + line.length;
    if (at <= end) {
      const next = change(line);
      if (next === line) return null;
      return src.slice(0, start) + next + src.slice(end);
    }
    start = end + 1;
  }
  return null;
}

// 上から数えて n 番目のタスクの印を入れ替える。位置の目印が付かないブロック
// （生 HTML の囲みを開いて描くもの）だけで使う。
export function toggleTaskNth(src: string, nth: number): string | null {
  const lines = src.split("\n");
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    const next = flip(lines[i]);
    if (next === lines[i]) continue;
    if (++seen !== nth) continue;
    lines[i] = next;
    return lines.join("\n");
  }
  return null;
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
const itemMarkerRe = (): RegExp =>
  new RegExp(
    `^\\s*(?:[-*+]|\\d+[.)])\\s+(?:\\[[${taskMarks()
      .concat("X")
      .map((c) => c.replace(/[\\\]^-]/g, "\\$&"))
      .join("")}]\\]\\s+)?`,
  );

// offset を含む 1 行から、マーカーを除いた「項目の本文」の範囲を求める。
// 子リストは別の行なので範囲に入らず、マーカーも保たれる。
export function itemTextRange(
  src: string,
  offset: number,
): { start: number; end: number } | null {
  const at = clampOffset(src, offset);
  const { lineStart, lineEnd } = lineRangeAt(src, at);
  const line = src.slice(lineStart, lineEnd);
  const marker = itemMarkerRe().exec(line);
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

export type CellUnit = Extract<Unit, { kind: "cell" }>;

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

export interface Cut {
  body: string;
  // ブロックが 1 つ減ったか（以降のブロック番号がずれる）。
  shift: boolean;
}

import type { Node as PmNode } from "prosemirror-model";
import type { Span } from "./fromMarkdown";

// 書き換わったところだけを原文へ差し込む。
//
// ブロックを構文木から組み直すと、原文の書き方（Notion の行継ぎ、行ごとに
// ばらばらな表の余白、行末の空白）が落ちる。構文木に残っていないので設定では
// 戻せない。戻せるのは原文からだけ。
//
// そこで、組み直す範囲そのものを縮める。子を 1 対 1 で突き合わせ、変わった子だけを
// 差し替えて、残りは原文のまま置く。行内の文字列まで同じことをするので、
// 1 文字打ったときに動くのはその 1 文字だけになる。
//
// 形が変わった（種類が違う・子の数が違う）ときは null を返し、呼び出し側が
// 丸ごと組み直す経路へ落ちる。

export function spliceNode(
  before: PmNode,
  after: PmNode,
  span: Span,
  source: string,
): string | null {
  const raw = source.slice(span.start, span.end);
  if (before.eq(after)) return raw;
  if (!before.sameMarkup(after)) return null;
  if (before.isText) return spliceText(before.text ?? "", after.text ?? "", raw);
  if (before.childCount !== after.childCount) return null;
  if (span.children.length !== before.childCount) return null;

  // 後ろから差し替える。前を先に触ると後ろの位置がずれる。
  let out = raw;
  for (let i = before.childCount - 1; i >= 0; i--) {
    const child = span.children[i];
    if (child.start < span.start || child.end > span.end || child.start > child.end) return null;
    const text = spliceNode(before.child(i), after.child(i), child, source);
    if (text === null) return null;
    out =
      out.slice(0, child.start - span.start) + text + out.slice(child.end - span.start);
  }
  return out;
}

// 原文の逃がし方（content\_scripts の \ など）を保ったまま、変わった部分だけ差し替える。
function spliceText(before: string, after: string, raw: string): string | null {
  const map = offsets(before, raw);
  if (!map) return null;

  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }

  return (
    raw.slice(0, map[head]) +
    after.slice(head, after.length - tail) +
    raw.slice(map[before.length - tail])
  );
}

// 値の各文字が原文のどこから来たかを引く表。読めなければ null。
//
// 原文にだけあって値に無いものを読み飛ばす。行末の空白、改行の直後の字下げ、
// 引用の "> "、CRLF の \r がそれにあたる。逃がしの \ は 2 文字で 1 文字。
function offsets(value: string, raw: string): number[] | null {
  return byChar(value, raw) ?? byLine(value, raw);
}

// 行ごとに突き合わせる。原文の行が値の行で終わっていれば、差は行頭の前置きだけ。
// コードの塊のように、行頭の字下げだけが落ちている場合はこれで拾える。
function byLine(value: string, raw: string): number[] | null {
  const vl = value.split("\n");
  const rl = raw.split("\n");
  // 塊の末尾に、前置きだけの行が残っていることがある。
  while (rl.length > vl.length && /^[ \t>]*$/.test(rl[rl.length - 1])) rl.pop();
  if (vl.length !== rl.length) return null;

  const map: number[] = [];
  let v = 0;
  let r = 0;
  for (let i = 0; i < vl.length; i++) {
    if (!rl[i].endsWith(vl[i])) return null;
    const lead = rl[i].slice(0, rl[i].length - vl[i].length);
    if (!/^[ \t>]*$/.test(lead)) return null;
    for (let k = 0; k < vl[i].length; k++) map[v + k] = r + lead.length + k;
    v += vl[i].length;
    r += rl[i].length;
    if (i < vl.length - 1) {
      map[v] = r;
      v++;
      r++;
    }
  }
  map[value.length] = raw.length;
  return map;
}

function byChar(value: string, raw: string): number[] | null {
  const map: number[] = [];
  let v = 0;
  let r = 0;

  // 行頭で、原文にだけ付いている前置きを読み飛ばす。箇条書きの字下げ、
  // 引用の "> "、字下げのコードの 4 空白やタブがこれにあたる。値の側にも
  // 空白が残っているときは、その分だけ残す。
  const skipAfterBreak = () => {
    let rr = r;
    while (rr < raw.length && /[ \t>]/.test(raw[rr])) rr++;
    let vv = v;
    while (vv < value.length && /[ \t>]/.test(value[vv])) vv++;
    const lead = raw.slice(r, rr);
    const keep = value.slice(v, vv);
    if (lead.endsWith(keep)) r += lead.length - keep.length;
  };

  // 字下げのコードは、行頭の空白が中身から落ちている。
  skipAfterBreak();

  while (v < value.length) {
    if (r >= raw.length) return null;

    // 改行の手前は、原文に空白が残っていることがある
    if (value[v] === "\n" && /[ \t\r]/.test(raw[r])) {
      r++;
      continue;
    }
    if (raw[r] === "\\" && raw[r + 1] === value[v]) {
      map[v] = r;
      r += 2;
      v++;
      continue;
    }
    if (raw[r] === value[v]) {
      map[v] = r;
      const wasBreak = value[v] === "\n";
      r++;
      v++;
      if (wasBreak) skipAfterBreak();
      continue;
    }
    // 実体参照など、1 文字ずつ対応しない書き方。
    return null;
  }

  // 末尾に原文だけの空白が残ることがある（行末の空白）。
  while (r < raw.length && /[ \t\r]/.test(raw[r])) r++;
  if (r !== raw.length) return null;
  map[value.length] = r;
  return map;
}

// 文字と数字だけの書き換えなら、Markdown の記号を作りようがない。
// 読み直して確かめるまでもなく、そのまま採用してよい。
const PLAIN = /^[\p{L}\p{N}]*$/u;

export function plainEdit(before: string, after: string): boolean {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  return (
    PLAIN.test(before.slice(head, before.length - tail)) &&
    PLAIN.test(after.slice(head, after.length - tail))
  );
}

// 差し込んだ結果が狙いどおりに読み直せるか。id は読み直すたびに変わるので外す。
export function sameShape(a: PmNode, b: PmNode): boolean {
  if (a.type !== b.type) return false;
  if (a.isText) return a.text === b.text && sameMarks(a, b);
  if (bare(a.attrs) !== bare(b.attrs)) return false;
  if (!sameMarks(a, b)) return false;
  if (a.childCount !== b.childCount) return false;
  for (let i = 0; i < a.childCount; i++) {
    if (!sameShape(a.child(i), b.child(i))) return false;
  }
  return true;
}

const sameMarks = (a: PmNode, b: PmNode): boolean =>
  a.marks.length === b.marks.length && a.marks.every((m, i) => m.eq(b.marks[i]));

// 見た目を覚えているだけの attrs は比べない。編集で桁幅や記号が変わっても
// 文書の意味は変わらないため。
const STYLE = new Set(["id", "widths", "delim", "marker", "tight", "fenced", "fence"]);

const bare = (attrs: Record<string, unknown>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(attrs).filter(([k]) => !STYLE.has(k))));

// フロントマターの鍵と値を、生テキストの範囲ごと取り出す。
//
// js-yaml で読んで書き戻すと、引用符・鍵の並び・日付の書き方まで組み直されて
// 差分が汚れる。本文と同じ作りにして（原文のどこから来たかを覚え、書き換わった
// ところだけ差し込む）、触っていない行は一字も動かさない。
//
// 扱うのは字下げ 0 の「鍵: 値」と、それに続く字下げ 0 の「- 項目」だけ。
// 入れ子の対応表・複数行の字・流し書きは見せるだけで打たせない。

export type Quote = "'" | '"' | null;

// 打てる箱 1 つ。at は生テキスト上の値の範囲。
export interface Cell {
  text: string;
  at: [number, number];
  quote: Quote;
}

export interface Field {
  key: string;
  // 鍵の範囲。打ち替えに使う。
  keyAt: [number, number];
  // scalar は 1 つ、並びは項目ごと。打てない値は空。
  cells: Cell[];
  // 打てない値を見せるための字。
  shown: string;
  // 値が「- 項目」の並びか。scalar とは Enter / Backspace の振る舞いが変わる。
  list: boolean;
  // この欄が占める行の範囲。並びの項目や入れ子の中身まで含む。
  // 消す・入れ替えるときはこの単位で動かす。
  lines: [number, number];
}

// 平文の scalar として置けない書き出し。
const OPENERS = /^[,[\]{}#&*!|>'"%@`]/;

const CLOSE = /^(---|\.\.\.)\s*$/;

export function fieldsOf(fm: string): Field[] {
  if (!/^---\r?\n/.test(fm)) return [];
  const out: Field[] = [];
  // 直前の鍵と、そこに並びを継げるか。値が空の鍵の下だけ「- 項目」を拾い、
  // 最初の項目で空の箱を捨てて並びに替える。
  let last: Field | null = null;
  let open: "" | "empty" | "list" = "";

  let at = fm.indexOf("\n") + 1;
  while (at < fm.length) {
    const nl = fm.indexOf("\n", at);
    const end = nl < 0 ? fm.length : nl;
    const line = fm.slice(at, end);
    const start = at;
    at = end + 1;

    if (CLOSE.test(line)) break;
    if (!line.trim() || line.trimStart().startsWith("#")) {
      if (last) last.lines[1] = at;
      continue;
    }

    // 字下げのある行は入れ子の中身。直前の鍵は打たせない。
    if (/^\s/.test(line)) {
      if (last) {
        last.cells = [];
        last.shown = "…";
        last.lines[1] = at;
      }
      open = "";
      continue;
    }

    if (open && last && /^-(\s|$)/.test(line)) {
      if (open === "empty") last.cells = [];
      open = "list";
      let v = 1;
      while (v < line.length && (line[v] === " " || line[v] === "\t")) v++;
      const raw = line.slice(v).replace(/\s+$/, "");
      const cell = cellOf(raw, start + v);
      if (cell) last.cells.push(cell);
      else last.cells = [];
      last.shown = last.cells.length ? "" : "…";
      last.list = last.cells.length > 0;
      last.lines[1] = at;
      continue;
    }

    const c = colonAt(line);
    if (c < 0) {
      // 鍵でも項目でもない行。直前の鍵の続きかもしれないので打たせない。
      if (last) {
        last.cells = [];
        last.shown = last.shown || "…";
        last.lines[1] = at;
      }
      open = "";
      continue;
    }

    let v = c + 1;
    while (v < line.length && (line[v] === " " || line[v] === "\t")) v++;
    const raw = line.slice(v).replace(/\s+$/, "");
    const key = line.slice(0, c).trimEnd();
    const field: Field = {
      key: unquote(key),
      keyAt: [start, start + key.length],
      cells: [],
      shown: raw,
      list: false,
      lines: [start, at],
    };
    const cell = cellOf(raw, start + v);
    if (cell) {
      field.cells = [cell];
      field.shown = cell.text;
    }
    out.push(field);
    last = field;
    // 値が空なら、次の行から始まる並びを拾う。
    open = raw === "" ? "empty" : "";
  }

  return out;
}

// ---- 書き換え ----

// 値を差し替える。
export function withValue(fm: string, cell: Cell, text: string): string {
  const [from, to] = cell.at;
  const head = fm.slice(0, from);
  // 値が空の鍵（"key:"）や項目（"-"）はその直後に差すので、区切りの空白を足す。
  const lead = /[:-]$/.test(head) ? " " : "";
  return head + lead + safeScalar(text, cell.quote) + fm.slice(to);
}

// 鍵を打ち替える。
export function withKey(fm: string, field: Field, key: string): string {
  const [from, to] = field.keyAt;
  return fm.slice(0, from) + safeScalar(key) + fm.slice(to);
}

// 欄ごと消す。並びの項目や入れ子の中身も一緒に消える。
export function dropField(fm: string, field: Field): string {
  return fm.slice(0, field.lines[0]) + fm.slice(field.lines[1]);
}

// 2 つの欄を入れ替える。行の範囲どうしを差し替えるので、間の行は動かない。
export function swapFields(fm: string, a: Field, b: Field): string {
  return swapSpans(fm, a.lines, b.lines);
}

// 並びの項目どうしを入れ替える。
export function swapItems(fm: string, a: Cell, b: Cell): string {
  return swapSpans(fm, lineSpan(fm, a.at[0]), lineSpan(fm, b.at[0]));
}

function swapSpans(
  fm: string,
  a: [number, number],
  b: [number, number],
): string {
  const [x, y] = a[0] < b[0] ? [a, b] : [b, a];
  return (
    fm.slice(0, x[0]) +
    fm.slice(y[0], y[1]) +
    fm.slice(x[1], y[0]) +
    fm.slice(x[0], x[1]) +
    fm.slice(y[1])
  );
}

// 末尾（閉じの --- の直前）に鍵を足す。
export function addField(fm: string, key: string): string {
  const at = closeAt(fm);
  return `${fm.slice(0, at) + safeScalar(key)}:\n${fm.slice(at)}`;
}

// 重なっていない鍵を選ぶ。「項目」「項目 2」…。
export function freeKey(fm: string, want: string): string {
  const used = new Set(fieldsOf(fm).map((f) => f.key));
  if (!used.has(want)) return want;
  for (let i = 2; ; i++) {
    if (!used.has(`${want} ${i}`)) return `${want} ${i}`;
  }
}

// 並びに項目を足す。指した項目のすぐ下に入る。
export function addItem(fm: string, after: Cell): string {
  const at = lineSpan(fm, after.at[0])[1];
  return `${fm.slice(0, at)}-\n${fm.slice(at)}`;
}

// 並びから項目を 1 つ消す。
export function dropItem(fm: string, cell: Cell): string {
  const [from, to] = lineSpan(fm, cell.at[0]);
  return fm.slice(0, from) + fm.slice(to);
}

// 何も無いファイルに付けるフロントマター。
export function newFrontmatter(title: string): string {
  return `---\ntitle: ${safeScalar(title)}\n---\n\n`;
}

// 打った字を YAML の scalar として置ける形にする。元が引用符付きなら形を保つ
// （'2026-09-02' を裸にすると日付として読まれてしまう）。
export function safeScalar(text: string, quote: Quote = null): string {
  if (quote === '"') return `"${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  if (quote === "'" || !bare(text)) return `'${text.replace(/'/g, "''")}'`;
  return text;
}

// ---- 中身 ----

// 引用符なしでそのまま置けるか。
function bare(text: string): boolean {
  if (text === "" || text !== text.trim()) return false;
  if (/[\n\r\t]/.test(text)) return false;
  if (OPENERS.test(text)) return false;
  if (/^[-?:](\s|$)/.test(text)) return false;
  if (text.includes(": ") || text.endsWith(":")) return false;
  if (text.includes(" #")) return false;
  return true;
}

// 鍵と値を分けるコロンの位置。YAML では「コロンの次が空白か行末」のものが境目。
function colonAt(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== ":") continue;
    if (i + 1 === line.length || line[i + 1] === " " || line[i + 1] === "\t") return i;
  }
  return -1;
}

// 閉じの --- が始まる位置。
function closeAt(fm: string): number {
  let at = fm.indexOf("\n") + 1;
  while (at < fm.length) {
    const nl = fm.indexOf("\n", at);
    const end = nl < 0 ? fm.length : nl;
    if (CLOSE.test(fm.slice(at, end))) return at;
    at = end + 1;
  }
  return fm.length;
}

// その位置を含む 1 行の範囲（末尾の改行まで）。
function lineSpan(fm: string, at: number): [number, number] {
  const from = fm.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  const nl = fm.indexOf("\n", at);
  return [from, nl < 0 ? fm.length : nl + 1];
}

// 引用符を外した字。外せない形ならそのまま返す。
function unquote(raw: string): string {
  if (raw.length >= 2 && raw[0] === "'" && raw.endsWith("'")) {
    const inner = raw.slice(1, -1);
    if (!inner.replace(/''/g, "").includes("'")) return inner.replace(/''/g, "'");
  }
  if (raw.length >= 2 && raw[0] === '"' && raw.endsWith('"')) {
    const inner = raw.slice(1, -1);
    if (!inner.includes("\\")) return inner;
  }
  return raw;
}

// 生の値から箱を作る。打たせない形なら null。
function cellOf(raw: string, from: number): Cell | null {
  const at: [number, number] = [from, from + raw.length];
  if (raw === "") return { text: "", at, quote: null };

  if (raw[0] === "'" && raw.length >= 2 && raw.endsWith("'")) {
    const inner = raw.slice(1, -1);
    if (inner.replace(/''/g, "").includes("'")) return null;
    return { text: inner.replace(/''/g, "'"), at, quote: "'" };
  }
  if (raw[0] === '"' && raw.length >= 2 && raw.endsWith('"')) {
    const inner = raw.slice(1, -1);
    // 逃がし字は解き直すと形が変わるので触らない。
    if (inner.includes("\\")) return null;
    return { text: inner, at, quote: '"' };
  }
  if (OPENERS.test(raw)) return null;
  return { text: raw, at, quote: null };
}

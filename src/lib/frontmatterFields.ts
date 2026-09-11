// フロントマターの値を、生テキストの範囲ごと取り出す。
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
  // scalar は 1 つ、並びは項目ごと。打てない値は空。
  cells: Cell[];
  // 打てない値を見せるための字。
  shown: string;
}

// 平文の scalar として置けない書き出し。
const OPENERS = /^[,[\]{}#&*!|>'"%@`]/;

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

    if (/^(---|\.\.\.)\s*$/.test(line)) break;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    // 字下げのある行は入れ子の中身。直前の鍵は打たせない。
    if (/^\s/.test(line)) {
      if (last) {
        last.cells = [];
        last.shown = "…";
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
      continue;
    }

    const c = colonAt(line);
    if (c < 0) {
      // 鍵でも項目でもない行。直前の鍵の続きかもしれないので打たせない。
      if (last) {
        last.cells = [];
        last.shown = last.shown || "…";
      }
      open = "";
      continue;
    }

    let v = c + 1;
    while (v < line.length && (line[v] === " " || line[v] === "\t")) v++;
    const raw = line.slice(v).replace(/\s+$/, "");
    const field: Field = { key: line.slice(0, c).trimEnd(), cells: [], shown: raw };
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

// 値を差し替えた生テキストを返す。
export function withValue(fm: string, cell: Cell, text: string): string {
  const [from, to] = cell.at;
  const head = fm.slice(0, from);
  // 値が空の鍵（"key:"）はコロンの直後に差すので、区切りの空白を足す。
  const lead = head.endsWith(":") ? " " : "";
  return head + lead + safeScalar(text, cell.quote) + fm.slice(to);
}

// 打った字を YAML の scalar として置ける形にする。元が引用符付きなら形を保つ
// （'2026-09-02' を裸にすると日付として読まれてしまう）。
export function safeScalar(text: string, quote: Quote = null): string {
  if (quote === '"') return `"${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  if (quote === "'" || !bare(text)) return `'${text.replace(/'/g, "''")}'`;
  return text;
}

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

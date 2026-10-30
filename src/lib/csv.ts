import type { Piece } from "./code";

// CSV・TSV の読み分け。読み方は RFC 4180 に沿う：`"…"` で囲んだ値の中の
// 区切りと改行は値の一部で、`""` は `"` 1 字。囲みは値の頭でだけ始まる
// （値の途中の `"` はただの字として読む）。

// 列の色の数。index.css の .mg-csv-c0〜c6 と対にする。
export const CSV_TONES = 7;

// 区切りの字。CSV・TSV でなければ null。
export function delimOf(nameOrPath: string): string | null {
  const lower = nameOrPath.toLowerCase();
  if (lower.endsWith(".csv")) return ",";
  if (lower.endsWith(".tsv")) return "\t";
  return null;
}

// 列の名前（A・B・…・Z・AA・AB・…）。0 から数える。
export function colName(n: number): string {
  let s = "";
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  }
  return s;
}

const toneOf = (col: number) => `mg-csv-c${col % CSV_TONES}`;

// 原文の行ごとの切れ端。値には列の色の名前を付け、区切りの字には付けない。
// 囲みの中の改行で原文の行が割れても、列の番号はそのまま続く。
export function csvLines(text: string, delim: string): Piece[][] {
  const lines: Piece[][] = [];
  let line: Piece[] = [];
  let buf = "";
  let col = 0;
  let quoted = false;
  let atStart = true;
  const flush = () => {
    if (buf) line.push({ text: buf, cls: toneOf(col) });
    buf = "";
  };
  const breakLine = () => {
    flush();
    lines.push(line);
    line = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\r") continue;
    if (quoted) {
      if (ch === "\n") breakLine();
      else if (ch === '"' && text[i + 1] === '"') {
        buf += '""';
        i++;
      } else {
        if (ch === '"') quoted = false;
        buf += ch;
      }
      continue;
    }
    if (ch === delim) {
      flush();
      line.push({ text: delim, cls: null });
      col++;
      atStart = true;
    } else if (ch === "\n") {
      breakLine();
      col = 0;
      atStart = true;
    } else {
      if (ch === '"' && atStart) quoted = true;
      buf += ch;
      atStart = false;
    }
  }
  breakLine();
  return lines;
}

// 表で使う値。行ごとの列の数がそろっていなければ、最も多い列の数まで空で
// 埋める。末尾の改行の後ろに空の行は作らない。
export function csvRows(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let atStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\r") continue;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (ch === delim) {
      row.push(field);
      field = "";
      atStart = true;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      atStart = true;
    } else {
      field += ch;
      atStart = false;
    }
  }
  if (field !== "" || row.length > 0 || quoted) {
    row.push(field);
    rows.push(row);
  }
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (const r of rows) while (r.length < width) r.push("");
  return rows;
}

// ---- 書き戻し ----
//
// 書き戻しは原文の該当の値だけを差し替える。ほかの値の囲み・改行の字
// （\r\n / \n）・末尾の改行は 1 字も変えない。

// 1 行の原文の中での、値ごとの範囲 [始め, 終わり) と、行の中身の終わり
// （改行の字の手前）。行の数え方は csvRows と同じ。
export interface CsvRowSpan {
  cells: [number, number][];
  end: number;
}

export function csvSpans(text: string, delim: string): CsvRowSpan[] {
  const rows: CsvRowSpan[] = [];
  let cells: [number, number][] = [];
  let from = 0;
  let quoted = false;
  let atStart = true;
  // 行の終わりの \r は値に含めない（csvRows は \r を読み飛ばす）。
  const lineEnd = (i: number) => (i > from && text[i - 1] === "\r" ? i - 1 : i);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\r") continue;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') i++;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (ch === delim) {
      cells.push([from, i]);
      from = i + 1;
      atStart = true;
    } else if (ch === "\n") {
      const end = lineEnd(i);
      cells.push([from, end]);
      rows.push({ cells, end });
      cells = [];
      from = i + 1;
      atStart = true;
    } else {
      atStart = false;
    }
  }
  if (text.slice(from).replace(/\r/g, "") !== "" || cells.length > 0 || quoted) {
    const end = lineEnd(text.length);
    cells.push([from, end]);
    rows.push({ cells, end });
  }
  return rows;
}

// 値を原文の 1 つの値として書く。区切り・" ・改行を含むか、元の値が囲みなら
// " で囲み、中の " を "" にする。値の中の改行はファイルの改行の字にそろえる。
function encodeValue(value: string, delim: string, eol: string, wasQuoted: boolean): string {
  const need = wasQuoted || value.includes(delim) || /["\r\n]/.test(value);
  if (!need) return value;
  return `"${value.replace(/\r?\n/g, eol).replace(/"/g, '""')}"`;
}

// 行 row（0 がヘッダー行）・列 col の値を value にした原文。行が無ければ原文のまま。
// 列が足りない短い行は、区切りを足して埋める。
export function setCell(text: string, delim: string, row: number, col: number, value: string): string {
  const span = csvSpans(text, delim)[row];
  if (!span) return text;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (col < span.cells.length) {
    const [s, e] = span.cells[col];
    return text.slice(0, s) + encodeValue(value, delim, eol, text[s] === '"') + text.slice(e);
  }
  const pad = delim.repeat(col - span.cells.length + 1);
  return text.slice(0, span.end) + pad + encodeValue(value, delim, eol, false) + text.slice(span.end);
}

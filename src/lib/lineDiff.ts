import { lcsPairs } from "./blockDiff";

// Markdown のソースを行単位で突き合わせる。組版を通さずに、書いたままの形で
// 比べるための差分。
//
// 変わっていない行は前後を少しだけ残して畳む。同じ行が延々と続くと、どこが
// 変わったのかを目で探すことになる。

export type LineKind = "same" | "add" | "del";

export interface DiffLine {
  kind: LineKind;
  // 行番号（1 始まり）。持たない側は null。
  a: number | null;
  b: number | null;
  text: string;
  // 書き換えの組。同じ切れ目で消えた行と入った行を結び付ける。行内のどこが
  // 変わったかを示すのに使う。
  pair?: number;
}

export interface Hunk {
  // 見出しに出す開始行（1 始まり）と行数。
  a: number;
  aCount: number;
  b: number;
  bCount: number;
  lines: DiffLine[];
}

export interface LineDiff {
  hunks: Hunk[];
  added: number;
  removed: number;
}

// 変わった行の前後に残す文脈。
export const CONTEXT = 3;

export function lineDiff(a: string, b: string): LineDiff {
  const left = splitLines(a);
  const right = splitLines(b);
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let pairs = 0;
  let i = 0;
  let j = 0;

  const gap = (untilA: number, untilB: number) => {
    // 同じ切れ目の消えた行と入った行を、出てきた順に組にする。
    const pair = untilA > i && untilB > j ? pairs++ : undefined;
    for (let k = i; k < untilA; k++) {
      lines.push({ kind: "del", a: k + 1, b: null, text: left[k], pair });
      removed++;
    }
    for (let k = j; k < untilB; k++) {
      lines.push({ kind: "add", a: null, b: k + 1, text: right[k], pair });
      added++;
    }
    i = untilA;
    j = untilB;
  };

  for (const [pa, pb] of lcsPairs(left, right)) {
    gap(pa, pb);
    lines.push({ kind: "same", a: i + 1, b: j + 1, text: left[i] });
    i++;
    j++;
  }
  gap(left.length, right.length);

  return { hunks: intoHunks(lines), added, removed };
}

// 変わっていない行の連なりを落とし、変わった行の前後だけを残す。
function intoHunks(lines: DiffLine[]): Hunk[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let n = 0; n < lines.length; n++) {
    if (lines[n].kind === "same") continue;
    for (
      let k = Math.max(0, n - CONTEXT);
      k <= Math.min(lines.length - 1, n + CONTEXT);
      k++
    ) {
      keep[k] = true;
    }
  }

  const hunks: Hunk[] = [];
  let run: DiffLine[] = [];
  const flush = () => {
    if (run.length === 0) return;
    hunks.push({
      a: run.find((l) => l.a !== null)?.a ?? 0,
      aCount: run.filter((l) => l.a !== null).length,
      b: run.find((l) => l.b !== null)?.b ?? 0,
      bCount: run.filter((l) => l.b !== null).length,
      lines: run,
    });
    run = [];
  };
  for (let n = 0; n < lines.length; n++) {
    if (keep[n]) run.push(lines[n]);
    else flush();
  }
  flush();
  return hunks;
}

// 末尾の改行 1 つは行として数えない。改行で終わるファイルに空行が
// 増えて見えてしまう。
function splitLines(text: string): string[] {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body === "" ? [] : body.split("\n");
}

// 分割表示の 1 行。消えた行と入った行が組になっているものは同じ行に並べる。
export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let n = 0;
  while (n < lines.length) {
    const line = lines[n];
    if (line.kind === "same") {
      rows.push({ left: line, right: line });
      n++;
      continue;
    }
    // 続く del と add をまとめて取り、順に左右へ振る。
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (n < lines.length && lines[n].kind === "del") dels.push(lines[n++]);
    while (n < lines.length && lines[n].kind === "add") adds.push(lines[n++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    }
  }
  return rows;
}

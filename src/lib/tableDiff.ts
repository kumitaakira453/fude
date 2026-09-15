import { lcsPairs } from "./blockDiff";
import { charDiff } from "./charDiff";

// 表の差分を、行とセルの単位で取る。
//
// 表はソースの上では 1 ブロックなので、ブロックどうしの突き合わせでは
// 「表が変わった」しか分からない。かといって表ぜんたいを 1 本の文字列にして
// 字で比べると、字数が charDiff の諦める長さを超えて印が 1 つも残らない。
//
// 行を対応付けてからセルごとに比べる。1 セルぶんの字数なら諦めず、増えた行・
// 減った行と、書き換わったセルの中の字までそのまま出せる。

export interface CellSpan {
  row: number;
  cell: number;
  from: number; // セルの中の文字位置（UTF-16 の添字）
  to: number;
}

export interface TableDiff {
  del: CellSpan[]; // 変更前の表の位置
  ins: CellSpan[]; // 変更後の表の位置
}

// 行の鍵に使う区切り。セルの中に現れない字を選ぶ。
const JOIN = "\u0000";

export function tableDiff(base: string[][], head: string[][]): TableDiff {
  const del: CellSpan[] = [];
  const ins: CellSpan[] = [];
  let bi = 0;
  let hi = 0;

  // 行まるごと。空のセルは印を持てないので飛ばす。
  const whole = (out: CellSpan[], row: number, cells: string[]) => {
    cells.forEach((text, cell) => {
      if (text.length > 0) out.push({ row, cell, from: 0, to: text.length });
    });
  };

  // 書き換わった行。桁ごとに比べ、違うセルだけに印を付ける。
  const pair = (b: number, h: number) => {
    const left = base[b];
    const right = head[h];
    const width = Math.max(left.length, right.length);
    for (let cell = 0; cell < width; cell++) {
      const from = left[cell] ?? "";
      const to = right[cell] ?? "";
      if (from === to) continue;
      const diff = charDiff(from, to);
      for (const span of diff.del) del.push({ row: b, cell, ...span });
      for (const span of diff.ins) ins.push({ row: h, cell, ...span });
    }
  };

  // 対応の付かない区間は、順に 1 対 1 で書き換わった行として組み、余った分を
  // 減った行・増えた行として出す（ブロックの突き合わせと同じ作法）。
  const gap = (untilBase: number, untilHead: number) => {
    while (bi < untilBase && hi < untilHead) {
      pair(bi, hi);
      bi++;
      hi++;
    }
    while (bi < untilBase) whole(del, bi, base[bi++]);
    while (hi < untilHead) whole(ins, hi, head[hi++]);
  };

  const keys = (rows: string[][]) => rows.map((row) => row.join(JOIN));
  for (const [pb, ph] of lcsPairs(keys(base), keys(head))) {
    gap(pb, ph);
    bi++;
    hi++;
  }
  gap(base.length, head.length);

  return { del, ins };
}

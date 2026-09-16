import { charDiff } from "./charDiff";
import { rangeAt, readBlockText, type BlockText } from "./domText";
import { tableDiff, type CellSpan } from "./tableDiff";

// 変更前と変更後の組の中で、変わった字だけに印を付ける。
//
// 描画結果どうしを比べるので、見た目が変わらない記法の違いには印が付かない。
// 組版を通した比較としてはそれが正しい（記法を見たいときはソースで比べる）。
//
// DOM は書き換えず、範囲だけを描画側へ渡す。属性やタグを足すと Markdown の
// 木を組み直すことになり、大きな文書で目に見えて遅くなる。
//
// バージョンの画面とレビューの画面が同じ道を通る。組の目印は
// [data-diff-pair]、その中の両側は [data-diff-side]。

// 印の名前。描画側は ::highlight() で拾う。
const DEL = "mg-diff-del";
const INS = "mg-diff-ins";

// 描き終わったあとに呼ぶ。返ってくるのは印を外す手。
export function applyDiffMarks(root: HTMLElement | null): (() => void) | undefined {
  const registry = "highlights" in CSS ? CSS.highlights : null;
  if (!registry) return;
  registry.delete(DEL);
  registry.delete(INS);
  if (!root) return;

  const dels: Range[] = [];
  const inss: Range[] = [];
  for (const pair of root.querySelectorAll<HTMLElement>("[data-diff-pair]")) {
    const a = pair.querySelector<HTMLElement>('[data-diff-side="base"]');
    const b = pair.querySelector<HTMLElement>('[data-diff-side="head"]');
    if (!a || !b) continue;
    if (markTable(a, b, dels, inss)) continue;
    const left = readBlockText(a);
    const right = readBlockText(b);
    const diff = charDiff(left.plain, right.plain);
    // 長すぎて突き合わせを諦めたときは、塊ごと変わったものとして扱う
    // （全部を塗ると、変わっていない字まで立ってしまう）。
    if (diff.gaveUp) continue;
    for (const span of diff.del) {
      const range = rangeAt(left, span.from, span.to);
      if (range) dels.push(range);
    }
    for (const span of diff.ins) {
      const range = rangeAt(right, span.from, span.to);
      if (range) inss.push(range);
    }
  }
  if (dels.length > 0) registry.set(DEL, new Highlight(...dels));
  if (inss.length > 0) registry.set(INS, new Highlight(...inss));

  return () => {
    registry.delete(DEL);
    registry.delete(INS);
  };
}

// 表どうしの組。行を対応付けてからセルごとに比べ、増えた行・減った行と、
// 書き換わったセルの中の字に印を付ける。表ぜんたいを 1 本の文字列として
// 比べると字数が多すぎて突き合わせを諦め、印が 1 つも残らない。
//
// 表でなければ false を返し、呼び出し側の組ぜんたいの比べ方に任せる。
function markTable(
  a: HTMLElement,
  b: HTMLElement,
  dels: Range[],
  inss: Range[],
): boolean {
  const left = a.querySelector("table");
  const right = b.querySelector("table");
  if (!left || !right) return false;

  const read = (table: HTMLTableElement) =>
    [...table.rows].map((row) => [...row.cells].map((cell) => readBlockText(cell)));
  const before = read(left);
  const after = read(right);
  const plain = (rows: BlockText[][]) => rows.map((row) => row.map((c) => c.plain));
  const diff = tableDiff(plain(before), plain(after));

  const put = (out: Range[], rows: BlockText[][], spans: CellSpan[]) => {
    for (const span of spans) {
      const cell = rows[span.row]?.[span.cell];
      const range = cell && rangeAt(cell, span.from, span.to);
      if (range) out.push(range);
    }
  };
  put(dels, before, diff.del);
  put(inss, after, diff.ins);
  return true;
}

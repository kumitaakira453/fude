import type { Attrs, Node as PmNode } from "prosemirror-model";
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { CellSelection, TableMap } from "prosemirror-tables";
import { schema } from "./schema";

// 編集面の表の行・列の操作。
//
// GFM の表は升目がそのまま並ぶだけで、セルの結合が無い。位置を数えながら差分を
// 当てるより、升目を配列として組み直して表ごと差し替える方が短く済む。見出しの
// 印と、原文の見た目の控え（桁幅・揃え・区切り行）を 1 か所で揃えられるのも
// この形の利点。
//
// 原文への書き戻しは `toMarkdown` の `tableText()` が受け持つ。そこは列ごとの
// 桁幅を覚えていて、列数が変わっていなければ区切り行も原文のものを使う。列の
// 数を変える操作では、この控えに同じ操作を当てないと桁がずれる。

export type TablePart = "row" | "col";

export type TableAct =
  | "insertBefore"
  | "insertAfter"
  | "duplicate"
  | "clear"
  | "delete";

// 原文の見た目の控え。表の節点が持っているものと同じ。
interface Style {
  align: (string | null)[];
  widths: number[];
  delim: string | null;
}

// 升目と控え。操作はこの形の上で行う。
interface Shape {
  rows: PmNode[][];
  style: Style;
  // 操作のあとカーソルを置く升目。
  at: { row: number; col: number } | null;
  // 操作のあと丸ごと選ぶ行・列。運んだあとは、どれを動かしたのかが見えて
  // いる方が分かる（升目 1 つにカーソルを置くと、行や列を動かしたことが
  // 読み取れない）。
  select?: { kind: TablePart; at: number };
}

const empty = () => schema.nodes.tableCell.create();

const blankRow = (width: number): PmNode[] =>
  Array.from({ length: width }, empty);

// 控えは列の数まで埋めて持つ。原文が短く持っていることもあり（揃えが無い表は
// 空の配列）、そのまま列の位置で継ぎ足すと隙間の分だけずれる。埋める値は
// 「揃え無し・詰めない」で、書き戻しの結果は変わらない。
const fit = <T,>(list: readonly T[], width: number, fill: T): T[] =>
  Array.from({ length: width }, (_, i) => list[i] ?? fill);

function shapeOf(table: PmNode): Shape {
  const rows: PmNode[][] = [];
  table.forEach((row) => {
    const cells: PmNode[] = [];
    row.forEach((cell) => cells.push(cell));
    rows.push(cells);
  });
  const width = rows[0]?.length ?? 0;
  return {
    rows,
    style: {
      align: fit((table.attrs.align as (string | null)[]) ?? [], width, null),
      widths: fit((table.attrs.widths as number[]) ?? [], width, 0),
      delim: (table.attrs.delim as string | null) ?? null,
    },
    at: null,
  };
}

// その行・列を丸ごと選んだ状態にする。
function selectPart(
  tr: Transaction,
  pos: number,
  kind: TablePart,
  at: number,
): Transaction {
  const table = tr.doc.nodeAt(pos);
  if (!table) return tr;
  const map = TableMap.get(table);
  const start = pos + 1;
  const cell = (row: number, col: number) =>
    tr.doc.resolve(start + map.map[row * map.width + col]);
  if (kind === "row") {
    if (at < 0 || at >= map.height) return tr;
    return tr.setSelection(
      CellSelection.rowSelection(cell(at, 0), cell(at, map.width - 1)),
    );
  }
  if (at < 0 || at >= map.width) return tr;
  return tr.setSelection(
    CellSelection.colSelection(cell(0, at), cell(map.height - 1, at)),
  );
}

// 升目から表を組む。1 行目のセルだけ見出しの印を立てる。
//
// 見出しかどうかはセルの属性で持っていて（`th` / `td` の出し分け）、行が動くと
// 合わなくなる。組むときに必ず揃える。
function build(attrs: Attrs, rows: PmNode[][]): PmNode {
  return schema.nodes.table.create(
    attrs,
    rows.map((cells, r) =>
      schema.nodes.tableRow.create(
        null,
        cells.map((cell) =>
          cell.attrs.header === (r === 0)
            ? cell
            : schema.nodes.tableCell.create(
                { ...cell.attrs, header: r === 0 },
                cell.content,
                cell.marks,
              ),
        ),
      ),
    ),
  );
}

// その升目の中身が始まる位置。
function cellPos(table: PmNode, pos: number, row: number, col: number): number {
  let at = pos + 1;
  for (let r = 0; r < row; r++) at += table.child(r).nodeSize;
  at += 1;
  const cells = table.child(row);
  for (let c = 0; c < col; c++) at += cells.child(c).nodeSize;
  return at + 1;
}

// 新しい列の桁幅。区切り行の "---" が収まる幅にしておくと、足した列だけ
// 詰め方が違って見えることがない。
const NEW_WIDTH = 5;

// 区切り行を控えから組み直す。
//
// 列の並びが変わると原文の区切り行はそのまま使えない。`tableText` は列数が
// 合わなければ捨てるので消すだけでも通るが、それだと組み直しの最小形
// （"| :- |"）になり、桁を揃えた表が崩れて見える。覚えている桁幅と揃えから
// 同じ幅で引き直す。列を触っていない表では原文と同じ行になる。
function delimOf(align: (string | null)[], widths: number[]): string {
  const cells = align.map((how, i) => {
    const least = how === "center" ? 3 : how ? 2 : 1;
    const room = Math.max(least, (widths[i] ?? 0) - 2);
    if (how === "center") return ` :${"-".repeat(room - 2)}: `;
    if (how === "left") return ` :${"-".repeat(room - 1)} `;
    if (how === "right") return ` ${"-".repeat(room - 1)}: `;
    return ` ${"-".repeat(room)} `;
  });
  return `|${cells.join("|")}|`;
}

// 列を差し込んだときの控え。`from` を渡すとその列の見た目を写す。
const styleInsert = (style: Style, at: number, from: number | null) => {
  style.align.splice(at, 0, from === null ? null : style.align[from]);
  style.widths.splice(at, 0, from === null ? NEW_WIDTH : style.widths[from]);
  style.delim = delimOf(style.align, style.widths);
};

const styleDelete = (style: Style, at: number) => {
  style.align.splice(at, 1);
  style.widths.splice(at, 1);
  style.delim = delimOf(style.align, style.widths);
};

function rowAct(shape: Shape, at: number, act: TableAct): Shape | null {
  const { rows } = shape;
  if (at < 0 || at >= rows.length) return null;
  // 1 行目は見出し。GFM の表では消せず、動かすとどの行が見出しかが黙って変わる。
  // 見出しの下へ差し込むのだけは行き先が一つに決まるので通す（見出しだけの表に
  // 本体の 1 行目を足す道でもある）。
  if (at < 1 && act !== "insertAfter") return null;
  const width = rows[0].length;
  switch (act) {
    case "insertBefore":
      rows.splice(at, 0, blankRow(width));
      shape.at = { row: at, col: 0 };
      return shape;
    case "insertAfter":
      rows.splice(at + 1, 0, blankRow(width));
      shape.at = { row: at + 1, col: 0 };
      return shape;
    case "duplicate":
      rows.splice(at + 1, 0, [...rows[at]]);
      shape.at = { row: at + 1, col: 0 };
      return shape;
    case "clear":
      rows[at] = blankRow(width);
      shape.at = { row: at, col: 0 };
      return shape;
    case "delete":
      rows.splice(at, 1);
      shape.at = { row: Math.min(at, rows.length - 1), col: 0 };
      return shape;
  }
}

function colAct(shape: Shape, at: number, act: TableAct): Shape | null {
  const { rows, style } = shape;
  const width = rows[0]?.length ?? 0;
  if (at < 0 || at >= width) return null;
  switch (act) {
    case "insertBefore":
      for (const cells of rows) cells.splice(at, 0, empty());
      styleInsert(style, at, null);
      shape.at = { row: 0, col: at };
      return shape;
    case "insertAfter":
      for (const cells of rows) cells.splice(at + 1, 0, empty());
      styleInsert(style, at + 1, null);
      shape.at = { row: 0, col: at + 1 };
      return shape;
    case "duplicate":
      for (const cells of rows) cells.splice(at + 1, 0, cells[at]);
      styleInsert(style, at + 1, at);
      shape.at = { row: 0, col: at + 1 };
      return shape;
    case "clear":
      // 見出しは列の名前なので残す。
      for (let r = 1; r < rows.length; r++) rows[r][at] = empty();
      shape.at = { row: Math.min(1, rows.length - 1), col: at };
      return shape;
    case "delete":
      // 最後の 1 列は残す。消すと表でなくなる。
      if (width <= 1) return null;
      for (const cells of rows) cells.splice(at, 1);
      styleDelete(style, at);
      // 見出しではなく本体の 1 行目へ置く（見出しは列の名前なので、消した
      // 直後に打ち始める場所ではない）。
      shape.at = { row: Math.min(1, rows.length - 1), col: Math.min(at, width - 2) };
      return shape;
  }
}

// 並べ替えの行き先は「差し込む隙間」で受ける（掴んで運ぶ側がそう数える）。
const slide = <T,>(list: T[], from: number, to: number): T[] => {
  const [taken] = list.splice(from, 1);
  list.splice(to > from ? to - 1 : to, 0, taken);
  return list;
};

function tableAt(state: EditorState, pos: number): PmNode | null {
  const node = state.doc.nodeAt(pos);
  return node && node.type === schema.nodes.table ? node : null;
}

// 組み直した表へ差し替える 1 手。
function replace(
  state: EditorState,
  pos: number,
  was: PmNode,
  shape: Shape,
): Transaction {
  const next = build({ ...was.attrs, ...shape.style }, shape.rows);
  const tr = state.tr.replaceWith(pos, pos + was.nodeSize, next);
  if (shape.select) return selectPart(tr, pos, shape.select.kind, shape.select.at);
  const spot = shape.at;
  if (spot && spot.row >= 0 && spot.col >= 0) {
    const table = tr.doc.nodeAt(pos);
    if (table && spot.row < table.childCount && spot.col < table.child(spot.row).childCount) {
      tr.setSelection(
        TextSelection.create(tr.doc, cellPos(table, pos, spot.row, spot.col)),
      );
    }
  }
  // 画面は動かさない。列を足したときに見出しの升目へカーソルが入るので、
  // そこへ寄せると表の頭まで巻き戻り、書いていた場所を見失う。
  return tr;
}

// 指した行・列に効かせる。効かないときは null（呼ぶ側は何もしない）。
export function tableActTr(
  state: EditorState,
  pos: number,
  kind: TablePart,
  at: number,
  act: TableAct,
): Transaction | null {
  const was = tableAt(state, pos);
  if (!was) return null;
  const shape = kind === "row" ? rowAct(shapeOf(was), at, act) : colAct(shapeOf(was), at, act);
  return shape ? replace(state, pos, was, shape) : null;
}

// 行・列を差し込む隙間へ運ぶ。
export function tableMoveTr(
  state: EditorState,
  pos: number,
  kind: TablePart,
  from: number,
  to: number,
): Transaction | null {
  const was = tableAt(state, pos);
  if (!was) return null;
  const shape = shapeOf(was);
  const height = shape.rows.length;
  const width = shape.rows[0]?.length ?? 0;

  if (kind === "row") {
    // 見出しは動かさず、見出しの上へも運ばせない。
    if (from < 1 || from >= height || to < 1 || to > height) return null;
    if (to === from || to === from + 1) return null;
    slide(shape.rows, from, to);
    shape.select = { kind: "row", at: to > from ? to - 1 : to };
    return replace(state, pos, was, shape);
  }

  if (from < 0 || from >= width || to < 0 || to > width) return null;
  if (to === from || to === from + 1) return null;
  for (const cells of shape.rows) slide(cells, from, to);
  slide(shape.style.align, from, to);
  slide(shape.style.widths, from, to);
  // 区切り行には列ごとの揃えが書かれている。並びに合わせて引き直す。
  shape.style.delim = delimOf(shape.style.align, shape.style.widths);
  shape.select = { kind: "col", at: to > from ? to - 1 : to };
  return replace(state, pos, was, shape);
}

// その行・列の升目が占める範囲。掴んでいるあいだ薄くする印に使う。
// いま選ばれている行 / 列。つまみを押し込んで見せるのに使う。
// セルの範囲を選んでいても、行 / 列を丸ごとでなければ null。
export function pickedPart(
  state: EditorState,
): { kind: TablePart; at: number } | null {
  const sel = state.selection;
  if (!(sel instanceof CellSelection)) return null;
  const row = sel.isRowSelection();
  const col = sel.isColSelection();
  if (row === col) return null; // どちらでもない / 表を丸ごと
  const $cell = sel.$anchorCell;
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const spot = map.findCell($cell.pos - $cell.start(-1));
  return row ? { kind: "row", at: spot.top } : { kind: "col", at: spot.left };
}

// 行・列を丸ごと選ぶ。つまみを押したときの「行選択」がこれ。
// 選べなければ null（表が無い / 範囲の外）。
export function tableSelectTr(
  state: EditorState,
  pos: number,
  kind: TablePart,
  at: number,
): Transaction | null {
  const table = state.doc.nodeAt(pos);
  // 表かどうかを見る。別の節点を渡されると TableMap が投げる。
  if (!table || table.type !== schema.nodes.table) return null;
  const map = TableMap.get(table);
  const limit = kind === "row" ? map.height : map.width;
  if (at < 0 || at >= limit) return null;
  return selectPart(state.tr, pos, kind, at);
}

export function tableSpans(
  doc: PmNode,
  pos: number,
  kind: TablePart,
  at: number,
): [number, number][] {
  const table = doc.nodeAt(pos);
  if (!table || table.type !== schema.nodes.table) return [];
  const map = TableMap.get(table);
  const start = pos + 1;
  const span = (offset: number): [number, number] => {
    const cell = table.nodeAt(offset);
    return [start + offset, start + offset + (cell?.nodeSize ?? 0)];
  };
  if (kind === "row") {
    if (at < 0 || at >= map.height) return [];
    return Array.from({ length: map.width }, (_, col) =>
      span(map.map[at * map.width + col]),
    );
  }
  if (at < 0 || at >= map.width) return [];
  return Array.from({ length: map.height }, (_, row) =>
    span(map.map[row * map.width + at]),
  );
}

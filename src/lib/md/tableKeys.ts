import type { Node as PmNode, ResolvedPos } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { TextSelection, type Command } from "prosemirror-state";
import { cellAround, TableMap } from "prosemirror-tables";
import { Decoration, DecorationSet } from "prosemirror-view";
import { schema } from "./schema";

// 表の中の移動を、見えているセルの並びに合わせる。
//
// 文書の並び順で動くと、上下の矢印が「次のブロック」へ抜けたり、右の矢印が
// 折り返しの続きへ進んだりして、表としての感覚と合わない。セルの升目を数えて
// 隣のセルへ渡す。

// いま居るセルと、その表の升目。
function cellAt(state: Parameters<Command>[0]) {
  const $cell = cellAround(state.selection.$head);
  if (!$cell) return null;
  const table = $cell.node(-1);
  const start = $cell.start(-1);
  const map = TableMap.get(table);
  return { $cell, start, map, rect: map.findCell($cell.pos - start) };
}

// カーソルがセルの中の上端 / 下端の行に居るか。
//
// view.endOfTextblock("up") は使わない。DOM 側の選択を 1 行動かして戻す作りで、
// 折り返しや <br> のあるセルでは WebKit が表の外まで動かしてしまい、判定が当てに
// ならない。カーソルとセルの両端の座標を直に比べる。
function atVerticalEdge(
  view: NonNullable<Parameters<Command>[2]>,
  $head: ResolvedPos,
  dy: number,
): boolean {
  const at = view.coordsAtPos($head.pos);
  const edge = view.coordsAtPos(dy < 0 ? $head.start() : $head.end());
  // 1px は行の高さの丸め分。同じ行と見なす。
  return dy < 0 ? at.top - edge.top <= 1 : edge.bottom - at.bottom <= 1;
}

// 升目を dx / dy だけ動かす。端なら何もしない。
function step(dx: number, dy: number): Command {
  return (state, dispatch, view) => {
    // 変換中は打鍵を IME が使っている。横取りすると確定できない。
    if (view?.composing) return false;
    if (!state.selection.empty) return false;

    const here = cellAt(state);
    if (!here) return false;

    const { $head } = state.selection;
    // 左右は字の端に着いてから渡す。
    if (dx < 0 && $head.parentOffset > 0) return false;
    if (dx > 0 && $head.parentOffset < $head.parent.content.size) return false;
    // 上下はセルの中の行を数えてから渡す。
    if (dy !== 0 && view && !atVerticalEdge(view, $head, dy)) return false;

    const col = here.rect.left + dx;
    const row = here.rect.top + dy;
    if (col < 0 || col >= here.map.width || row < 0 || row >= here.map.height) {
      return false;
    }

    if (dispatch) {
      const at = here.start + here.map.map[row * here.map.width + col];
      const $at = state.doc.resolve(at);
      dispatch(
        state.tr
          .setSelection(TextSelection.near($at, dx < 0 || dy < 0 ? -1 : 1))
          .scrollIntoView(),
      );
    }
    return true;
  };
}

export const cellLeft = step(-1, 0);
export const cellRight = step(1, 0);
export const cellUp = step(0, -1);
export const cellDown = step(0, 1);

// セルの中で行を分けるもの。GFM の表は行を分けられないので原文でも <br> になる。
function isBreak(node: PmNode): boolean {
  if (node.type === schema.nodes.hardBreak) return true;
  return (
    node.type === schema.nodes.rawInline &&
    /^<br\s*\/?>$/i.test(node.attrs.value as string)
  );
}

// カーソルの居る行の両端。セルの中を <br> で区切って、その区間を返す。
function lineIn($head: ResolvedPos): { from: number; to: number } {
  const start = $head.start();
  let from = start;
  let to = start + $head.parent.content.size;
  let offset = 0;
  $head.parent.forEach((node) => {
    const a = start + offset;
    const b = a + node.nodeSize;
    offset += node.nodeSize;
    if (!isBreak(node)) return;
    if (b <= $head.pos) from = Math.max(from, b);
    else if (a >= $head.pos && a < to) to = a;
  });
  return { from, to };
}

// ⌘← / ⌘→ はカーソルの居る行の端へ。セルの外は既定の動きに任せる。
function edge(dir: -1 | 1): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    if (!cellAt(state)) return false;
    const { $head } = state.selection;
    const line = lineIn($head);
    const at = dir < 0 ? line.from : line.to;
    if (at === $head.pos) return false;
    if (dispatch) {
      dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, at)).scrollIntoView(),
      );
    }
    return true;
  };
}

export const cellStart = edge(-1);
export const cellEnd = edge(1);

// Enter は下のセルへ。表の外や最下段では、いつもの働きに任せる。
export const cellEnter: Command = (state, dispatch, view) => {
  if (view?.composing) return false;
  if (!cellAt(state)) return false;
  return step(0, 1)(state, dispatch, view);
};

// いま居るセルに印を付ける。どのセルを触っているかが見て分かるようにする。
export const focusedCell = new Plugin({
  props: {
    decorations(state) {
      const $cell = cellAround(state.selection.$head);
      const cell = $cell?.nodeAfter;
      if (!$cell || !cell) return null;
      return DecorationSet.create(state.doc, [
        Decoration.node($cell.pos, $cell.pos + cell.nodeSize, {
          class: "is-focused",
        }),
      ]);
    },
  },
});

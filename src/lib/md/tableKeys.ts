import { Plugin } from "prosemirror-state";
import { TextSelection, type Command } from "prosemirror-state";
import { cellAround, TableMap } from "prosemirror-tables";
import { Decoration, DecorationSet } from "prosemirror-view";

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

// 升目を dx / dy だけ動かす。端なら何もしない。
function step(dx: number, dy: number): Command {
  return (state, dispatch, view) => {
    // 変換中は打鍵を IME が使っている。横取りすると確定できない。
    if (view?.composing) return false;
    if (!state.selection.empty) return false;

    const here = cellAt(state);
    if (!here) return false;

    const { $head } = state.selection;
    // 左右は字の端に着いてから渡す。上下は行の端に着いてから。
    if (dx < 0 && $head.parentOffset > 0) return false;
    if (dx > 0 && $head.parentOffset < $head.parent.content.size) return false;
    if (dy < 0 && view && !view.endOfTextblock("up")) return false;
    if (dy > 0 && view && !view.endOfTextblock("down")) return false;

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

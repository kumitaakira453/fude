import type { Node as PmNode, ResolvedPos } from "prosemirror-model";
import {
  Plugin,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
} from "prosemirror-state";
import { cellAround, TableMap } from "prosemirror-tables";
import { Decoration, DecorationSet } from "prosemirror-view";
import { covers } from "./decos";
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

// 2 つの位置が同じ視覚行に居るか。
//
// 上端 / 下端をそのまま引き算しないのは、同じ行でも箱の高さが揃わないため。
// 行内コードは上下に余白と背景を持つので素の文字より数 px 高く、しきい値を
// 数 px にすると同じ行を別の行と誤る。縦の重なりで見れば高さの違いに強い。
function sameLine(a: { top: number; bottom: number }, b: { top: number; bottom: number }) {
  const height = Math.min(a.bottom - a.top, b.bottom - b.top);
  // 高さが取れないときは上端だけで見る。
  if (height <= 0) return Math.abs(a.top - b.top) <= 1;
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return overlap > height / 2;
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
  try {
    const at = view.coordsAtPos($head.pos);
    const edge = view.coordsAtPos(dy < 0 ? $head.start() : $head.end());
    return sameLine(at, edge);
  } catch {
    // 測れないときは渡す側へ倒す。上下が効かないほうが困る。
    return true;
  }
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

    // 升目の外。上下は自分で表の外へ出す。ここで既定に流すと、WebKit は表の中を
    // DOM 順に動かすので、下端でさらに下を押すと右のセルへ順に移ってしまう。
    if (row < 0 || row >= here.map.height) {
      if (dy === 0) return false;
      const table = here.$cell.node(-1);
      const from = here.$cell.before(-1);
      const to = from + table.nodeSize;
      const $at = state.doc.resolve(dy < 0 ? from : to);
      const out = Selection.near($at, dy < 0 ? -1 : 1);
      // 表の外に行き先が無ければ動かさない。それでも既定へは流さない。
      if (dispatch && (out.from <= from || out.from >= to)) {
        dispatch(state.tr.setSelection(out).scrollIntoView());
      }
      return true;
    }
    if (col < 0 || col >= here.map.width) return false;

    if (dispatch) {
      // TableMap が持つのはセルの「手前」の位置。そこから逆方向に探すと 1 つ前の
      // セルに落ちるので、セルの中の位置を出してから置く。
      const before = here.start + here.map.map[row * here.map.width + col];
      const cell = state.doc.nodeAt(before);
      const back = dx < 0 || dy < 0;
      // 戻る向きなら移動先の末尾、進む向きなら頭。字を追う感覚に合わせる。
      const at = before + 1 + (back ? (cell?.content.size ?? 0) : 0);
      dispatch(
        state.tr
          .setSelection(TextSelection.near(state.doc.resolve(at), back ? -1 : 1))
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
// 印は状態に持つ（毎回作り直すと打鍵ごとに節点を描き直させてしまう）。
// 同じセルの中を動いている間も作り直さない。
function cellDecos(state: EditorState, prev: DecorationSet): DecorationSet {
  const $cell = cellAround(state.selection.$head);
  const cell = $cell?.nodeAfter;
  if (!$cell || !cell) return DecorationSet.empty;
  const to = $cell.pos + cell.nodeSize;
  if (covers(prev, $cell.pos, to)) return prev;
  return DecorationSet.create(state.doc, [
    Decoration.node($cell.pos, to, { class: "is-focused" }),
  ]);
}

export const focusedCell = new Plugin<DecorationSet>({
  state: {
    init: (_, state) => cellDecos(state, DecorationSet.empty),
    apply: (tr, prev, _old, next) => {
      if (!tr.docChanged && !tr.selectionSet) return prev;
      // 本文が動いたら位置が合わないので、使い回しの相手にはしない。
      return cellDecos(next, tr.docChanged ? DecorationSet.empty : prev);
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

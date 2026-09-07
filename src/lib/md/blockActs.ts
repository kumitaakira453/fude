import type { Node as PmNode } from "prosemirror-model";
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { schema } from "./schema";

// 編集面のブロックの操作。足す・複製する・消す・並べ替える。
//
// 相手はトップレベルの何番目か。原文の行番号ではなく編集モデルの位置で扱うので、
// ⌘Z が普通に効き、書き戻しは `toMarkdown` がそのまま受け持つ。
//
// 原文との対応で気をつけることが 2 つある。
//
// 足したブロックには目印（`id`）を付けない。`toMarkdown` は目印が無ければ
// 原文から出す道を諦めて組み直すので、それでよい。
//
// 複製したブロックは目印を落とす。同じ目印が 2 つあると、原文の範囲
// （`ranges` / `spans`）や読み直し（`reload.ts`）が 1 対 1 で対応できなくなる。

export type BlockAct = "insertBefore" | "insertAfter" | "duplicate" | "delete";

// そのブロックが原文のどこから来たかを忘れさせる。
const anonymous = (node: PmNode): PmNode =>
  node.type.create({ ...node.attrs, id: null }, node.content, node.marks);

// 何番目のブロックがどこから始まるか。
function offsetOf(doc: PmNode, index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += doc.child(i).nodeSize;
  return at;
}

// 位置からトップレベルの何番目かを出す。
export function blockIndexAt(doc: PmNode, pos: number): number | null {
  let at = 0;
  for (let i = 0; i < doc.childCount; i++) {
    if (at === pos) return i;
    at += doc.child(i).nodeSize;
  }
  return null;
}

// 空の段落。足すときの中身。
const blank = () => schema.nodes.paragraph.create();

// 書いたところへカーソルを置く。中身のあるブロックなら先頭、空なら中。
function caretInto(tr: Transaction, index: number): Transaction {
  const doc = tr.doc;
  if (index < 0 || index >= doc.childCount) return tr;
  const at = offsetOf(doc, index) + 1;
  const $at = doc.resolve(Math.min(at, doc.content.size));
  return tr.setSelection(TextSelection.near($at));
}

export function blockActTr(
  state: EditorState,
  index: number,
  act: BlockAct,
): Transaction | null {
  const doc = state.doc;
  if (index < 0 || index >= doc.childCount) return null;
  const node = doc.child(index);
  const from = offsetOf(doc, index);

  switch (act) {
    case "insertBefore":
      return caretInto(state.tr.insert(from, blank()), index);
    case "insertAfter":
      return caretInto(state.tr.insert(from + node.nodeSize, blank()), index + 1);
    case "duplicate":
      return caretInto(
        state.tr.insert(from + node.nodeSize, anonymous(node)),
        index + 1,
      );
    case "delete": {
      // 最後の 1 つを消すと本文が空になる。空の段落を残して書き続けられる
      // ようにする（ProseMirror の doc は中身を 1 つ以上要る）。
      if (doc.childCount === 1) {
        return caretInto(state.tr.replaceWith(0, doc.content.size, blank()), 0);
      }
      const tr = state.tr.delete(from, from + node.nodeSize);
      return caretInto(tr, Math.min(index, tr.doc.childCount - 1));
    }
  }
}

// 並べ替える。`to` は「動かす前の並びで、どのブロックの前に置くか」。
// 読むとき側（`blocks.ts` の `moveBlock`）と同じ数え方。
//
// 運んだブロックは目印を落とす。`toMarkdown` は原文から出すとき「本文の並びと
// 原文の並びは同じ」を前提に、ブロックの間の空きを原文からそのまま持ってくる。
// 目印を残したまま運ぶと、間の空きとして飛び越えた分の原文がもう一度出て
// 本文が二重になる。目印を落とせばそのブロックは組み直しになり、原文側の
// 元の場所は「消えたブロック」として抜かれる。
export function blockMoveTr(
  state: EditorState,
  from: number,
  to: number,
): Transaction | null {
  const doc = state.doc;
  if (from < 0 || from >= doc.childCount) return null;
  if (to < 0 || to > doc.childCount) return null;
  if (to === from || to === from + 1) return null;

  const node = doc.child(from);
  const at = offsetOf(doc, from);
  const tr = state.tr.delete(at, at + node.nodeSize);
  const landing = to > from ? to - 1 : to;
  tr.insert(offsetOf(tr.doc, landing), anonymous(node));
  return caretInto(tr, landing);
}

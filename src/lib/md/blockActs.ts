import type { Node as PmNode } from "prosemirror-model";
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { schema } from "./schema";

// 編集面のブロックの操作。足す・複製する・消す・並べ替える。
//
// 相手は「そのブロックが始まる位置」。本文の一番外の並びも、トグルの中身も
// 同じ指し方になる。原文の行番号ではなく編集モデルの位置で扱うので、⌘Z が
// 普通に効き、書き戻しは `toMarkdown` がそのまま受け持つ。
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

// その位置から始まるブロック。位置がブロックの頭でなければ相手にしない。
function blockAt(doc: PmNode, pos: number): PmNode | null {
  if (pos < 0 || pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  return node && node.isBlock ? node : null;
}

// 空の段落。足すときの中身。
const blank = () => schema.nodes.paragraph.create();

// 書いたところへカーソルを置く。中身のあるブロックなら先頭、空なら中。
function caretInto(tr: Transaction, pos: number): Transaction {
  if (!tr.doc.nodeAt(pos)) return tr;
  const $at = tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size));
  return tr.setSelection(TextSelection.near($at));
}

export function blockActTr(
  state: EditorState,
  pos: number,
  act: BlockAct,
): Transaction | null {
  const doc = state.doc;
  const node = blockAt(doc, pos);
  if (!node) return null;
  const after = pos + node.nodeSize;

  switch (act) {
    case "insertBefore":
      return caretInto(state.tr.insert(pos, blank()), pos);
    case "insertAfter":
      return caretInto(state.tr.insert(after, blank()), after);
    case "duplicate":
      return caretInto(state.tr.insert(after, anonymous(node)), after);
    case "delete": {
      // 入れ物は中身を 1 つ以上要る（本文も、トグルの中も）。抜くと形が
      // 崩れるなら、書き続けられる空の段落に置き換える。
      const $at = doc.resolve(pos);
      const at = $at.index();
      if (!$at.parent.canReplace(at, at + 1)) {
        return caretInto(state.tr.replaceWith(pos, after, blank()), pos);
      }
      const tr = state.tr.delete(pos, after);
      // 抜けた場所に次のブロックが来ていればそこ、末尾だったなら手前へ。
      const $to = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
      return tr.setSelection(TextSelection.near($to, tr.doc.nodeAt(pos) ? 1 : -1));
    }
  }
}

// 並べ替える。`to` は「動かす前の本文で、どの位置に置くか」。落とし先が
// トグルの中でも同じ（位置がそのまま入れ物の中を指す）。
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
  const node = blockAt(doc, from);
  if (!node) return null;
  if (to < 0 || to > doc.content.size) return null;
  const end = from + node.nodeSize;
  // 動かない運びと、自分の中への運び。
  if (to === from || to === end) return null;
  if (to > from && to < end) return null;

  const tr = state.tr.delete(from, end);
  const at = tr.mapping.map(to);
  const $at = tr.doc.resolve(at);
  // その入れ物が受け取れる形か（トグルの題の前などには置けない）。
  if (!$at.parent.canReplaceWith($at.index(), $at.index(), node.type)) return null;
  tr.insert(at, anonymous(node));
  return caretInto(tr, at);
}

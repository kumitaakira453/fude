import type { Node as PmNode } from "prosemirror-model";
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { schema } from "./schema";

// 編集面の箇条書きの項目の操作。足す・複製する・消す。
//
// Markdown ではリスト全体が 1 つのブロックだが、書く側の感覚では項目ごとが
// 1 つのまとまり。読むとき側（`blocks.ts` の項目の操作）と同じ単位で扱う。
// 入れ子はその項目の中に入っているので、項目を動かせば子も一緒に動く。
//
// 原文への書き戻しはリストのブロックごと `toMarkdown` が受け持つ。項目を
// 足したり消したりすると子の数が変わるので、そのリストは組み直しになる
// （`splice.ts` は子の並びが同じときだけ原文へ差し込む）。
//
// 並べ替えは `listTree.ts`。階層をまたいで動かすので、並びを列に開いてから
// 組み直す。

export type ItemAct = "insertBefore" | "insertAfter" | "duplicate" | "delete";

const isList = (node: PmNode) =>
  node.type === schema.nodes.bulletList || node.type === schema.nodes.orderedList;

interface Spot {
  list: PmNode;
  // リストが始まる位置。
  listPos: number;
  // その項目がリストの中で何番目か。
  index: number;
  item: PmNode;
}

// 項目の位置（その項目が始まるところ）から、親のリストと並びの位置を出す。
export function itemSpotAt(doc: PmNode, pos: number): Spot | null {
  if (pos < 0 || pos > doc.content.size) return null;
  let $at;
  try {
    $at = doc.resolve(pos);
  } catch {
    return null;
  }
  const list = $at.parent;
  if (!isList(list) || $at.depth < 1) return null;
  const index = $at.index();
  if (index >= list.childCount) return null;
  return { list, listPos: $at.before($at.depth), index, item: list.child(index) };
}

// 空の項目。チェックリストの中ではチェックの付いた項目にする。
const blankItem = (like: PmNode) =>
  schema.nodes.listItem.create(
    { checked: like.attrs.checked === null ? null : false },
    schema.nodes.paragraph.create(),
  );

// その項目の中身の先頭へカーソルを置く。
function caretInto(tr: Transaction, listPos: number, index: number): Transaction {
  const list = tr.doc.nodeAt(listPos);
  if (!list || index < 0 || index >= list.childCount) return tr;
  let at = listPos + 1;
  for (let i = 0; i < index; i++) at += list.child(i).nodeSize;
  const $at = tr.doc.resolve(Math.min(at + 2, tr.doc.content.size));
  return tr.setSelection(TextSelection.near($at));
}

export function itemActTr(
  state: EditorState,
  pos: number,
  act: ItemAct,
): Transaction | null {
  const spot = itemSpotAt(state.doc, pos);
  if (!spot) return null;
  const { list, listPos, index, item } = spot;

  switch (act) {
    case "insertBefore":
      return caretInto(state.tr.insert(pos, blankItem(item)), listPos, index);
    case "insertAfter":
      return caretInto(
        state.tr.insert(pos + item.nodeSize, blankItem(item)),
        listPos,
        index + 1,
      );
    case "duplicate":
      return caretInto(
        state.tr.insert(pos + item.nodeSize, item),
        listPos,
        index + 1,
      );
    case "delete": {
      // 最後の 1 つを消すとリストが成り立たない（listItem+）。リストごと消す。
      if (list.childCount === 1) {
        const tr = state.tr.delete(listPos, listPos + list.nodeSize);
        // 本文が空になるなら、書き続けられる段落を残す。
        if (tr.doc.childCount === 0) {
          const empty = state.tr.replaceWith(
            0,
            state.doc.content.size,
            schema.nodes.paragraph.create(),
          );
          return empty.setSelection(TextSelection.near(empty.doc.resolve(1)));
        }
        return tr;
      }
      const tr = state.tr.delete(pos, pos + item.nodeSize);
      return caretInto(tr, listPos, Math.min(index, list.childCount - 2));
    }
  }
}

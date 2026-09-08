import type { Node as PmNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { schema } from "./schema";

// いま打ち直している式。
//
// 位置と対象はプラグインが持ち、入力欄は React の側に出す（絵文字の盤と同じ
// 作り）。本文が動いたら位置を写し、そこが式でなくなったら閉じる。

export const mathKey = new PluginKey<number | null>("mgMath");

export const isMath = (node: PmNode | null | undefined): boolean =>
  node?.type === schema.nodes.inlineMath || node?.type === schema.nodes.mathBlock;

export function openMath(view: EditorView, pos: number): void {
  view.dispatch(view.state.tr.setMeta(mathKey, pos));
}

export function closeMath(view: EditorView): void {
  if (mathKey.getState(view.state) === null) return;
  view.dispatch(view.state.tr.setMeta(mathKey, null));
}

// 打ち直した中身を当てる。空なら節点ごと消す（中身の無い式を残さない）。
export function applyMath(view: EditorView, pos: number, tex: string): void {
  const node = view.state.doc.nodeAt(pos);
  if (!isMath(node) || !node) return;
  const tr = view.state.tr;
  if (tex.trim() === "") tr.delete(pos, pos + node.nodeSize);
  else tr.setNodeMarkup(pos, undefined, { tex, raw: null });
  view.dispatch(tr.setMeta(mathKey, null));
}

export const mathEditing = new Plugin<number | null>({
  key: mathKey,
  state: {
    init: () => null,
    apply(tr, prev) {
      const meta = tr.getMeta(mathKey) as number | null | undefined;
      if (meta !== undefined) return meta;
      if (prev === null) return null;
      const pos = tr.mapping.map(prev, -1);
      return isMath(tr.doc.nodeAt(pos)) ? pos : null;
    },
  },
});

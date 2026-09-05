import type { Node as PmNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { schema } from "./schema";

// 編集面のコールアウトのアイコン。読むときは開きタグの属性を書き換えるが、
// 編集面では節点の attrs を差し替える。盤（絵文字の一覧）は読むときと同じものを使う。

export interface CalloutHit {
  // 囲みの節点の位置。
  pos: number;
  node: PmNode;
}

// 押されたところがコールアウトのアイコンなら、その囲みを返す。
//
// アイコンは中身の外に置かれていて位置を持たない。中身の入れ物から位置を測り、
// そこから囲みまで遡る。
export function calloutIcoAt(view: EditorView, target: EventTarget | null): CalloutHit | null {
  const ico = target instanceof Element ? target.closest(".mg-callout-ico") : null;
  const box = ico?.closest(".mg-callout");
  const body = box?.querySelector(":scope > .mg-callout-body");
  if (!body || !view.dom.contains(body)) return null;

  let at: number;
  try {
    at = view.posAtDOM(body, 0);
  } catch {
    return null;
  }
  if (at < 0) return null;

  const $at = view.state.doc.resolve(at);
  for (let d = $at.depth; d > 0; d--) {
    if ($at.node(d).type === schema.nodes.callout) {
      return { pos: $at.before(d), node: $at.node(d) };
    }
  }
  return null;
}

// アイコンを差し替える。空文字なら書き戻しで属性ごと落ちる。
export function setCalloutIcon(view: EditorView, pos: number, icon: string): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type !== schema.nodes.callout) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, icon }));
}

import type { EditorView } from "prosemirror-view";

// 選んでいる範囲。編集モデルの位置で数える。
export interface Span {
  from: number;
  to: number;
}

// DOM が今持っている選択。編集モデルの位置に直して返す。
//
// 範囲を引いている間の描き直しはここから測る。selectionchange は仕様で
// 「次のタスク」に配られるので、mousemove と同じ番では来ない。編集モデルの
// 選択はそれを見て更新されるため、そこから描くと必ず 1 番遅れて、引いている
// 手に塗りが付いてこない。標準の塗りはブラウザが自分で塗るので遅れない。
// DOM 側の選択はドラッグに合わせてその場で伸びているので、それを測る。
export function domSpan(view: EditorView): Span | null {
  const sel = view.dom.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (
    !view.dom.contains(range.startContainer) ||
    !view.dom.contains(range.endContainer)
  ) {
    return null;
  }
  try {
    const a = view.posAtDOM(range.startContainer, range.startOffset);
    const b = view.posAtDOM(range.endContainer, range.endOffset);
    if (a < 0 || b < 0 || a === b) return null;
    return { from: Math.min(a, b), to: Math.max(a, b) };
  } catch {
    return null;
  }
}

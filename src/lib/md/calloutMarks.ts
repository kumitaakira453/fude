import type { Node as PmNode } from "prosemirror-model";
import { Plugin, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { calloutKind } from "../callout";
import { schema } from "./schema";

// 囲み（> [!IMPORTANT] など）の目印の字。囲みは見出しと色で種類を見せるので、
// 目印はふだん隠す。カーソルが目印のある段落に入ったときだけ出し、打ち替えて
// 種類を変えたり、消してふつうの引用に戻したりできるようにする。

// 目印と、その後ろの空白・改行まで（中身の 1 行目を目印の行に詰めない）。
const MARK = /^\s*\[![A-Za-z]+\][ \t]*\n?/;

interface Spot {
  // 目印の範囲。
  from: number;
  to: number;
  // 目印のある段落の範囲。カーソルがここに居れば目印を見せる。
  para: [number, number];
}

function spotsOf(doc: PmNode): Spot[] {
  const out: Spot[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== schema.nodes.blockquote) return true;
    const first = node.firstChild;
    if (!first?.isTextblock || !calloutKind(first.textContent)) return true;
    const m = MARK.exec(first.textContent);
    if (!m) return true;
    const start = pos + 2;
    out.push({
      from: start,
      to: start + m[0].length,
      para: [pos + 1, pos + 1 + first.nodeSize],
    });
    return true;
  });
  return out;
}

function decosOf(state: EditorState): DecorationSet {
  const head = state.selection.head;
  const decos = spotsOf(state.doc).map((s) => {
    const inside = head > s.para[0] && head < s.para[1];
    return Decoration.inline(s.from, s.to, {
      class: inside ? "mg-callout-mark" : "mg-callout-mark is-hidden",
    });
  });
  return DecorationSet.create(state.doc, decos);
}

// 選択が動いても、どの段落の中に居るかが変わらなければ作り直さない（作り直すと
// ProseMirror は装飾が変わったと見て、その段落を描き直す）。
const placeOf = (state: EditorState): string =>
  spotsOf(state.doc)
    .filter((s) => state.selection.head > s.para[0] && state.selection.head < s.para[1])
    .map((s) => s.from)
    .join(",");

export const calloutMarks = new Plugin<{ set: DecorationSet; at: string }>({
  state: {
    init: (_, state) => ({ set: decosOf(state), at: placeOf(state) }),
    apply: (tr, prev, _old, next) => {
      if (tr.docChanged) return { set: decosOf(next), at: placeOf(next) };
      if (!tr.selectionSet) return prev;
      const at = placeOf(next);
      return at === prev.at ? prev : { set: decosOf(next), at };
    },
  },
  props: {
    decorations(state) {
      return this.getState(state)?.set;
    },
  },
});

import { Plugin, PluginKey } from "prosemirror-state";
import type { Node as PmNode } from "prosemirror-model";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Span } from "./domSpan";
import { schema } from "./schema";

// いま打ち直しているところに印を付ける。
//
// 式や行き先は本文の外の小窓で打ち直すので、そのままではどこを直しているのかが
// 本文の側で分からない。打ち直しているあいだだけ、その範囲を塗る。

export const editingKey = new PluginKey<Marked>("mgEditing");

interface Marked {
  span: Span | null;
  decos: DecorationSet;
}

// 印を付ける / 外す。tr に相乗りできるよう、meta の名前を出しておく。
export function markEditing(view: EditorView, span: Span | null): void {
  view.dispatch(view.state.tr.setMeta(editingKey, span));
}

const same = (a: Span, b: Span) => a.from === b.from && a.to === b.to;

// 行内コードは途中で切らず、札ごと覆う。
//
// 行内の印は装飾の切れ目ごとに別の箱として描かれる。行内コードは自分の地と
// 余白を持つので、その途中で切ると札の半分だけ色が変わり、1 つの札が 2 つに
// 割れて見える。
function snap(doc: PmNode, span: Span): Span {
  const $from = doc.resolve(span.from);
  if (!$from.parent.inlineContent || doc.resolve(span.to).parent !== $from.parent) {
    return span;
  }
  const start = $from.start();
  let { from, to } = span;
  $from.parent.forEach((child, offset) => {
    if (!schema.marks.code.isInSet(child.marks)) return;
    const a = start + offset;
    const b = a + child.nodeSize;
    if (a < from && from < b) from = a;
    if (a < to && to < b) to = b;
  });
  return { from, to };
}

function build(doc: PmNode, asked: Span): DecorationSet {
  const span = snap(doc, asked);
  const node = doc.nodeAt(span.from);
  // 式のように中身を持たない塊は、節点そのものに印を付ける（行内の印は
  // 中身の字に付くので、字を持たないものには乗らない）。字そのものは節点の
  // 印を受け取らないので、必ず行内で付ける。
  const whole =
    !!node && !node.isText && node.isAtom && span.from + node.nodeSize === span.to;
  return DecorationSet.create(doc, [
    whole
      ? Decoration.node(span.from, span.to, { class: "mg-editing" })
      : Decoration.inline(span.from, span.to, { class: "mg-editing" }),
  ]);
}

export const editingMark = new Plugin<Marked>({
  key: editingKey,
  state: {
    init: () => ({ span: null, decos: DecorationSet.empty }),
    apply(tr, prev) {
      const meta = tr.getMeta(editingKey) as Span | null | undefined;
      const span =
        meta !== undefined
          ? meta
          : prev.span && {
              from: tr.mapping.map(prev.span.from, -1),
              to: tr.mapping.map(prev.span.to, 1),
            };
      if (!span || span.to <= span.from) {
        return prev.span === null ? prev : { span: null, decos: DecorationSet.empty };
      }
      // 同じところを指しているあいだは作り直さない。作り直すと ProseMirror が
      // 「装飾が変わった」と見て、打鍵ごとに節点を描き直す。
      if (prev.span && same(prev.span, span) && !tr.docChanged) return prev;
      return { span, decos: build(tr.doc, span) };
    },
  },
  props: {
    decorations: (state) => editingKey.getState(state)?.decos ?? null,
  },
});

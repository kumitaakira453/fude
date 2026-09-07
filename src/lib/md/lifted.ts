import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

// 掴んでいるあいだ、実体を薄くする印。
//
// クラスを DOM へ直に足すと消える。ProseMirror は属性の変化を本文の書き換えと
// して扱う（`registerMutation` が属性の mutation に対して節点の範囲を返す）ので、
// その節点を描き直してクラスごと戻してしまう。装飾として渡せば ProseMirror が
// 持ち主になり、描き直しでも残る。
//
// 印を置く / 外すのは transaction の meta で頼む。空の配列で外す。

export const liftedKey = new PluginKey<DecorationSet>("lifted");

export type LiftedSpans = [number, number][];

export const lifted = new Plugin<DecorationSet>({
  key: liftedKey,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, prev) {
      const spans = tr.getMeta(liftedKey) as LiftedSpans | undefined;
      if (spans) {
        return spans.length
          ? DecorationSet.create(
              tr.doc,
              spans.map(([from, to]) =>
                Decoration.node(from, to, { class: "mg-lifting" }),
              ),
            )
          : DecorationSet.empty;
      }
      return tr.docChanged ? prev.map(tr.mapping, tr.doc) : prev;
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

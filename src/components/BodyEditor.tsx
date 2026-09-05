import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef } from "react";
import { fromMarkdown } from "../lib/md/fromMarkdown";
import { schema } from "../lib/md/schema";
import { toMarkdown } from "../lib/md/toMarkdown";

// 組版されたまま書く全文編集。
//
// 中身は編集モデル（ProseMirror）で、Markdown は保存のときに書き戻す。
// 触っていないところは原文のまま出るので、1 文字打っても動くのはその 1 文字だけ。
//
// 扱うのは本文だけ。フロントマターは前に付け直して返す。

export function BodyEditor({
  body,
  prefix,
  className,
  onChange,
  onSave,
}: {
  body: string;
  // フロントマター。本文の前にそのまま戻す。
  prefix: string;
  className?: string;
  onChange: (raw: string) => void;
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const changed = useRef(onChange);
  const saved = useRef(onSave);
  changed.current = onChange;
  saved.current = onSave;

  useEffect(() => {
    const at = host.current;
    if (!at) return;

    const loaded = fromMarkdown(body);
    const item = schema.nodes.listItem;
    const state = EditorState.create({
      doc: loaded.doc,
      plugins: [
        history(),
        keymap({
          "Mod-s": () => {
            saved.current();
            return true;
          },
          "Mod-z": undo,
          "Shift-Mod-z": redo,
          "Mod-y": redo,
          Enter: splitListItem(item),
          Tab: sinkListItem(item),
          "Shift-Tab": liftListItem(item),
        }),
        keymap(baseKeymap),
      ],
    });

    const view = new EditorView(at, {
      state,
      attributes: { class: "mg-pm" },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) changed.current(prefix + toMarkdown(next.doc, loaded));
      },
    });
    view.focus();

    return () => view.destroy();
    // 本文を差し替えるのはファイルを開き直したときだけ。呼び出し側が key で作り直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className={className} />;
}

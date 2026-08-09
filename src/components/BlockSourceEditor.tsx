import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { continueList } from "./MarkdownEditor";

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--mg-fg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--mg-font-mono)",
    fontSize: "14px",
    lineHeight: "1.7",
  },
  ".cm-content": { padding: "0.1rem 0", caretColor: "var(--mg-accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--mg-accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--mg-accent-soft)",
  },
});

// 単一ブロックの生ソースをその場で編集する軽量エディタ。
// 確定: フォーカスアウト / ⌘Enter、取消: Esc。
export function BlockSourceEditor({
  src,
  onCommit,
  onCancel,
}: {
  src: string;
  onCommit: (newSrc: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancel);
  onCommitRef.current = onCommit;
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!ref.current) return;
    // 確定/取消済みフラグ。blur による二重確定・取消後の確定を防ぐ。
    const done = { value: false };
    const view = new EditorView({
      parent: ref.current,
      state: EditorState.create({
        doc: src,
        extensions: [
          history(),
          keymap.of([
            {
              key: "Mod-Enter",
              preventDefault: true,
              run: (v) => {
                done.value = true;
                onCommitRef.current(v.state.doc.toString());
                return true;
              },
            },
            {
              key: "Escape",
              preventDefault: true,
              run: () => {
                done.value = true;
                onCancelRef.current();
                return true;
              },
            },
            { key: "Enter", run: continueList },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          indentUnit.of("    "),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping,
          EditorView.domEventHandlers({
            blur: () => {
              if (!done.value) {
                done.value = true;
                onCommitRef.current(view.state.doc.toString());
              }
              return false;
            },
          }),
          theme,
        ],
      }),
    });
    view.focus();
    // カーソルは末尾に（クリックした場所の近くから編集を続けやすい）
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mg-block-editor">
      <div ref={ref} className="mg-block-cm" />
      <div className="mg-block-hint" contentEditable={false}>
        <kbd>⌘ ↵</kbd>
        <span>確定</span>
        <span className="mg-block-hint-sep">·</span>
        <kbd>esc</kbd>
        <span>取消</span>
      </div>
    </div>
  );
}

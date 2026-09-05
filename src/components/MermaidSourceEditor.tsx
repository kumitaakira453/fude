import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { mermaidHighlight, mermaidLang } from "../lib/mermaidLang";

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--mg-fg)", height: "100%" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--mg-font-mono)",
    fontSize: "12.5px",
    lineHeight: "1.75",
    overflow: "auto",
  },
  ".cm-content": { padding: "0.35rem 0", caretColor: "var(--mg-accent)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--mg-muted)",
    opacity: "0.55",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 0.5rem 0 0.25rem" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--mg-accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--mg-accent-soft)",
  },
});

// 図のソースを書く欄。エラーは行番号で示されるので行番号を出す。
// 打つたびに onChange を呼び、描き直しの間隔は呼び出し側が決める。
export function MermaidSourceEditor({
  src,
  onChange,
  onSave,
  onCancel,
}: {
  src: string;
  onChange: (next: string) => void;
  onSave: (src: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onChange, onSave, onCancel });
  handlers.current = { onChange, onSave, onCancel };

  useEffect(() => {
    if (!ref.current) return;
    // CodeMirror は View を作るたびに差し込み先の <style> を書き直す。
    // document へ差し込むと本文全体のスタイル再計算が走るので、shadow root
    // の中に閉じる（差し込みが adoptedStyleSheets になる）。
    const shadow =
      ref.current.shadowRoot ?? ref.current.attachShadow({ mode: "open" });
    const view = new EditorView({
      parent: shadow,
      root: shadow,
      state: EditorState.create({
        doc: src,
        extensions: [
          history(),
          lineNumbers(),
          keymap.of([
            {
              key: "Mod-Enter",
              preventDefault: true,
              run: (v) => {
                handlers.current.onSave(v.state.doc.toString());
                return true;
              },
            },
            {
              key: "Escape",
              preventDefault: true,
              run: () => {
                handlers.current.onCancel();
                return true;
              },
            },
            // WKWebView にネイティブで取られても効かせる
            { key: "Mod-z", preventDefault: true, run: undo },
            { key: "Mod-Shift-z", preventDefault: true, run: redo },
            { key: "Mod-y", preventDefault: true, run: redo },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          indentUnit.of("  "),
          mermaidLang,
          mermaidHighlight,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
          }),
          theme,
        ],
      }),
    });
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ref} className="mg-mmd-cm" />;
}

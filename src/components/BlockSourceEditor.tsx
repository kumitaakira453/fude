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
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import {
  continueList,
  markdownHighlight,
  markdownLang,
} from "./MarkdownEditor";

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
  clickX,
  clickY,
}: {
  src: string;
  onCommit: (newSrc: string) => void;
  onCancel: () => void;
  // 編集開始時のダブルクリック座標（ビューポート）。カーソルをその近くに置く。
  clickX?: number | null;
  clickY?: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancel);
  const clickRef = useRef({ x: clickX, y: clickY });
  // 確定/取消済みフラグ。blur による二重確定・取消後の確定を防ぐ。
  const doneRef = useRef({ value: false });
  onCommitRef.current = onCommit;
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!ref.current) return;
    // この回のフラグを作り直す。持ち回すと、前の回の片付けで立った値を
    // 引き継いでしまい、本当の blur で確定できなくなる。
    const done = { value: false };
    doneRef.current = done;
    // CodeMirror は View を作るたびに、差し込み先の <style> の中身を丸ごと
    // 書き直す。document へ差し込むと、そのたびに本文全体のスタイル再計算
    // （65,000 字で 246ms）が走る。この場の編集は shadow root の中に閉じる。
    // shadow root なら差し込みが adoptedStyleSheets になり、外の本文の
    // スタイルは無効にならない。見た目は CodeMirror の theme 側に持たせて
    // あるので、外の CSS には依存しない。
    const shadow =
      ref.current.shadowRoot ?? ref.current.attachShadow({ mode: "open" });
    const view = new EditorView({
      parent: shadow,
      root: shadow,
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
            // Undo/Redo を明示（WKWebView でネイティブに取られても効かせる）
            { key: "Mod-z", preventDefault: true, run: undo },
            { key: "Mod-Shift-z", preventDefault: true, run: redo },
            { key: "Mod-y", preventDefault: true, run: redo },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          indentUnit.of("    "),
          markdownLang,
          markdownHighlight,
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
    // ダブルクリックした画面座標に最も近いソース位置へカーソルを置く。
    // 座標が無い/範囲外なら先頭へ。
    const { x, y } = clickRef.current;
    const pos =
      x != null && y != null ? view.posAtCoords({ x, y }) : null;
    view.dispatch({ selection: { anchor: pos ?? 0 } });
    return () => {
      // 片付けの blur は確定ではない。destroy() は blur を飛ばすので、
      // ここで印を立てないと、開いた直後に確定して閉じてしまう。
      done.value = true;
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mg-block-editor">
      <div ref={ref} className="mg-block-cm" />
    </div>
  );
}

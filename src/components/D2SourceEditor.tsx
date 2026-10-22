import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { Annotation, EditorState, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { EditorView, GutterMarker, gutterLineClass, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { d2Lang } from "../lib/d2Lang";
import { mermaidHighlight } from "../lib/mermaidLang";

// .d2 のファイルを書く面。打つたびに onChange へ全文を渡す（保存と描き直しは
// 呼ぶ側が間合いを取る）。外で書き換わった中身は adopt で入れ替える。
//
// BlockSourceEditor と同じく shadow root の中に置く（CodeMirror の style の
// 差し込みで、外の本文のスタイル計算を走らせない）。

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "var(--mg-fg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--mg-font-mono)",
    fontSize: "12.5px",
    lineHeight: "21px",
    overscrollBehavior: "none",
  },
  ".cm-content": { padding: "10px 0", caretColor: "var(--mg-accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--mg-accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--mg-accent-soft)",
  },
  // 行番号の列は左に貼り付いたまま、横に送った本文がその下を通る。地を塗らないと
  // 本文が透けて番号と重なる。
  ".cm-gutters": {
    backgroundColor: "var(--mg-bg)",
    border: "none",
    color: "var(--mg-muted)",
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "3.2rem", padding: "0 1rem 0 0" },
  ".cm-gutterElement.is-bad": { color: "var(--mg-danger)", fontWeight: "600" },
});

// 外から入れ替えた変更の印。onChange へ返さない（返すと保存し直してしまう）。
const fromOutside = Annotation.define<boolean>();

// エラーの行。行番号を赤くする。
const markBad = StateEffect.define<number | null>();
const badMarker = new (class extends GutterMarker {
  elementClass = "is-bad";
})();
const badLine = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    for (const e of tr.effects) {
      if (!e.is(markBad)) continue;
      const line = e.value;
      if (line === null || line < 1 || line > tr.state.doc.lines) return RangeSet.empty;
      return RangeSet.of([badMarker.range(tr.state.doc.line(line).from)]);
    }
    return tr.docChanged ? set.map(tr.changes) : set;
  },
  provide: (f) => gutterLineClass.from(f),
});

export function D2SourceEditor({
  initial,
  adopt,
  errorLine,
  composing,
  onChange,
}: {
  initial: string;
  // 外から入れる中身。seq が変わるたびに入れ替える。
  adopt: { text: string; seq: number } | null;
  errorLine: number | null;
  // 変換中（IME）かを問い合わせる口を入れる。変換中は描き直さないため。
  composing?: React.MutableRefObject<() => boolean>;
  onChange: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!ref.current) return;
    const shadow = ref.current.shadowRoot ?? ref.current.attachShadow({ mode: "open" });
    const view = new EditorView({
      parent: shadow,
      root: shadow,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          keymap.of([
            // Undo/Redo を明示（WKWebView でネイティブに取られても効かせる）
            { key: "Mod-z", preventDefault: true, run: undo },
            { key: "Mod-Shift-z", preventDefault: true, run: redo },
            { key: "Mod-y", preventDefault: true, run: redo },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          indentUnit.of("  "),
          lineNumbers(),
          badLine,
          d2Lang,
          mermaidHighlight,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(fromOutside))) {
              onChangeRef.current(u.state.doc.toString());
            }
          }),
          theme,
        ],
      }),
    });
    viewRef.current = view;
    if (composing) composing.current = () => view.composing;
    return () => {
      if (composing) composing.current = () => false;
      viewRef.current = null;
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !adopt) return;
    const now = view.state.doc.toString();
    if (now === adopt.text) return;
    const head = Math.min(view.state.selection.main.head, adopt.text.length);
    view.dispatch({
      changes: { from: 0, to: now.length, insert: adopt.text },
      selection: { anchor: head },
      annotations: fromOutside.of(true),
    });
  }, [adopt]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: markBad.of(errorLine) });
  }, [errorLine]);

  return <div ref={ref} className="mg-d2src" />;
}

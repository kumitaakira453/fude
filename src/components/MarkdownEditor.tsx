import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle, indentUnit } from "@codemirror/language";
import { livePreview } from "../lib/livePreview";

// リスト行で Enter: 同じインデント/マーカーを継続。空項目ならマーカーを消して抜ける。
function continueList(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const m = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line.text);
  if (!m) return false;
  const [, indent, marker, space, checkbox = "", content] = m;

  if (content.length === 0) {
    // 空項目 → 行を空にしてリストから抜ける
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "" },
      selection: { anchor: line.from },
    });
    return true;
  }

  let nextMarker = marker;
  if (/\d+[.)]/.test(marker)) {
    const num = parseInt(marker, 10) + 1;
    nextMarker = num + marker.replace(/\d+/, "");
  }
  const nextCheckbox = checkbox ? "[ ] " : "";
  const insert = "\n" + indent + nextMarker + space + nextCheckbox;
  view.dispatch({
    changes: { from: range.head, insert },
    selection: { anchor: range.head + insert.length },
    scrollIntoView: true,
  });
  return true;
}

const theme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--mg-bg)",
    color: "var(--mg-fg)",
    fontSize: "15px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--mg-font-sans)",
    lineHeight: "1.75",
    overflow: "auto",
    padding: "2rem 0",
  },
  ".cm-content": {
    maxWidth: "820px",
    margin: "0 auto",
    padding: "0 2.5rem",
    caretColor: "var(--mg-accent)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--mg-accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--mg-accent-soft)",
  },
});

export function MarkdownEditor({
  initialDoc,
  onChange,
  onSave,
}: {
  initialDoc: string;
  onChange: (text: string) => void;
  onSave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!ref.current) return;
    const view = new EditorView({
      parent: ref.current,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          history(),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current();
                return true;
              },
            },
            { key: "Enter", run: continueList }, // リスト継続
            indentWithTab, // Tab / Shift-Tab でインデント調整
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          indentUnit.of("    "), // インデント幅 = 半角スペース4
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(defaultHighlightStyle),
          livePreview,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
          theme,
        ],
      }),
    });
    view.focus();
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ref} className="mg-cm min-h-0 min-w-0 flex-1 overflow-hidden" />;
}

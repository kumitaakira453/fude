import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
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
import { livePreview } from "../lib/livePreview";

// リスト行で Enter: 同じインデント/マーカーを継続。空項目ならマーカーを消して抜ける。
// 見た目と文法解析に関わる拡張は 1 回だけ作り、どのエディタからも同じものを
// 使う。開くたびに作り直すと、そのたびにスタイルモジュールが差し込まれ、
// 本文全体のスタイル再計算（65,000 字で 235ms）が走る。
export const markdownLang = markdown({ base: markdownLanguage });
export const markdownHighlight = syntaxHighlighting(defaultHighlightStyle);

export function continueList(view: EditorView): boolean {
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
    scrollbarWidth: "thin",
    scrollbarColor: "var(--mg-border) transparent",
  },
  ".cm-content": {
    maxWidth: "820px",
    margin: "0 auto",
    padding: "0 2.5rem",
    caretColor: "var(--mg-accent)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--mg-accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
    {
      backgroundColor: "var(--mg-accent-soft)",
    },
  // ライブプレビューの見た目。shadow root の中では外の CSS が効かないので、
  // ここに持たせる。
  ".cm-lp-h1": { fontSize: "1.9em", fontWeight: "700", lineHeight: "1.25" },
  ".cm-lp-h2": { fontSize: "1.55em", fontWeight: "700", lineHeight: "1.3" },
  ".cm-lp-h3": { fontSize: "1.3em", fontWeight: "600" },
  ".cm-lp-h4": { fontSize: "1.15em", fontWeight: "600" },
  ".cm-lp-h5, .cm-lp-h6": { fontSize: "1.05em", fontWeight: "600" },
  ".cm-lp-bold": { fontWeight: "700", color: "var(--mg-fg)" },
  ".cm-lp-italic": { fontStyle: "italic" },
  ".cm-lp-strike": {
    textDecoration: "line-through",
    color: "var(--mg-muted)",
  },
  ".cm-lp-code": {
    fontFamily: "var(--mg-font-mono)",
    fontSize: "0.9em",
    background: "var(--mg-accent-soft)",
    color: "var(--mg-accent2)",
    borderRadius: "0.3rem",
    padding: "0.1em 0.3em",
  },
  ".cm-lp-link": {
    color: "var(--mg-accent)",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
});

export function MarkdownEditor({
  initialDoc,
  onChange,
  onSave,
  initialOffset = 0,
  onOffset,
}: {
  initialDoc: string;
  onChange: (text: string) => void;
  onSave: () => void;
  // プレビューから引き継ぐ位置（本文の先頭からの文字数）。割合ではなく位置で
  // 受ける。割合は組まれた高さが変わると別の場所を指す。
  initialOffset?: number;
  // 今見ている位置を親へ報告（プレビューへ戻るときに使う）。
  onOffset?: (offset: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 報告は View を組んだあとに差し替える（拡張の中から呼ぶため）。
  const tellRef = useRef(() => {});
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onOffsetRef = useRef(onOffset);
  const initialOffsetRef = useRef(initialOffset);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onOffsetRef.current = onOffset;

  useEffect(() => {
    if (!ref.current) return;
    // CodeMirror は View を作るたびに、差し込み先の <style> の中身を丸ごと
    // 書き直す。document へ差し込むと、そのたびに本文全体のスタイル再計算
    // （65,000 字で 246ms）が走る。shadow root なら adoptedStyleSheets を
    // 使うので、外のスタイルは無効にならない。
    const shadow =
      ref.current.shadowRoot ?? ref.current.attachShadow({ mode: "open" });
    const view = new EditorView({
      parent: shadow,
      root: shadow,
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
            // Undo/Redo を明示（WKWebView でネイティブに取られても効かせる）
            { key: "Mod-z", preventDefault: true, run: undo },
            { key: "Mod-Shift-z", preventDefault: true, run: redo },
            { key: "Mod-y", preventDefault: true, run: redo },
            indentWithTab, // Tab / Shift-Tab でインデント調整
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          indentUnit.of("    "), // インデント幅 = 半角スペース4
          markdownLang,
          markdownHighlight,
          livePreview,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
            // カーソルを動かしただけでも、見ている場所として控えておく。
            if (u.docChanged || u.selectionSet) tellRef.current();
          }),
          theme,
        ],
      }),
    });

    // 目線を動かさない復元。渡された位置を画面の先頭に置き、カーソルも
    // そこへ置く（先頭へ飛ばさない）。
    const s = view.scrollDOM;
    // 位置を渡すのは、渡された位置へ合わせたあとだけ。合わせる前に報告すると、
    // まだ先頭に居る状態（0）で控えを上書きしてしまう。
    let restored = false;
    const restore = () => {
      const at = Math.max(
        0,
        Math.min(initialOffsetRef.current, view.state.doc.length),
      );
      // 打ち始める場所が要るのでカーソルもそこへ置く。行が上端で切れて
      // 見えないと落ち着かないので、少し余白を取る。
      view.dispatch({
        selection: { anchor: at },
        effects: EditorView.scrollIntoView(at, { y: "start", yMargin: 12 }),
      });
      restored = true;
    };
    const raf = requestAnimationFrame(restore);

    // 今見ている位置を報告する。カーソルが画面の中にあればカーソル、外に
    // あれば画面の先頭行。プレビューへ戻るときにこの位置を使う。
    const current = (): number => {
      const top = view.lineBlockAtHeight(s.scrollTop + 1);
      const bottom = view.lineBlockAtHeight(s.scrollTop + s.clientHeight - 1);
      const head = view.state.selection.main.head;
      return head >= top.from && head <= bottom.to ? head : top.from;
    };
    // 生きているあいだに報告しておく。片付けは DOM が外れた後に走るので、
    // そこで測ると scrollTop が 0 に見え、控えを 0 で上書きしてしまう。
    let report = 0;
    const tell = () => {
      if (!restored) return;
      cancelAnimationFrame(report);
      report = requestAnimationFrame(() => onOffsetRef.current?.(current()));
    };
    s.addEventListener("scroll", tell, { passive: true });
    tellRef.current = tell;

    view.focus();
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(report);
      // 閉じる時点の位置を渡す。カーソルを動かしただけでも引き継がれる。
      s.removeEventListener("scroll", tell);
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={ref} className="mg-cm min-h-0 min-w-0 flex-1 overflow-hidden" />
  );
}

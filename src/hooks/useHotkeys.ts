import { useStore } from "jotai";
import { useEffect } from "react";
import { splitPane } from "../lib/ui";
import * as A from "../state/atoms";

// 入力欄以外で選択中のテキストを検索語プリフィル用に取得する
function selectionText(): string {
  const ae = document.activeElement as HTMLElement | null;
  if (
    ae?.tagName === "INPUT" ||
    ae?.tagName === "TEXTAREA" ||
    ae?.isContentEditable
  )
    return "";
  const s = window.getSelection?.()?.toString().trim() ?? "";
  return s.length > 0 && s.length <= 200 ? s : "";
}

export function useHotkeys() {
  const store = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        store.set(A.paletteOpenAtom, !store.get(A.paletteOpenAtom));
      } else if (mod && e.shiftKey && (e.key === "f" || e.key === "F")) {
        // ⌘⇧F: ディレクトリ全体検索（サイドバー）。選択語をプリフィルし入力欄へフォーカス。
        e.preventDefault();
        // 検索語の引き継ぎ: 選択があれば優先、なければ ⌘F のファイル内検索語を維持
        const carry = selectionText() || store.get(A.highlightAtom)?.term || "";
        if (carry) store.set(A.searchQueryAtom, carry);
        // ファイル内検索ウィジェットが開いていたら閉じる（ディレクトリ検索へ移る）
        store.set(A.docFindOpenAtom, false);
        store.set(A.sidebarOpenAtom, true);
        store.set(A.sidebarTabAtom, "search");
        store.set(A.searchFocusNonceAtom, store.get(A.searchFocusNonceAtom) + 1);
      } else if (mod && (e.key === "f" || e.key === "F")) {
        // ⌘F: 現在ファイル内検索（本文の find ウィジェット）。
        // 検索語の引き継ぎ: 選択 > サイドバー検索語 > 既存のハイライト語。
        e.preventDefault();
        const carry =
          selectionText() ||
          store.get(A.searchQueryAtom) ||
          store.get(A.highlightAtom)?.term ||
          "";
        if (carry) {
          store.set(A.highlightAtom, {
            term: carry,
            caseSensitive: false,
            useRegex: false,
            wholeWord: false,
            nonce: Math.random(),
          });
        }
        store.set(A.docFindOpenAtom, true);
        store.set(A.docFindNonceAtom, store.get(A.docFindNonceAtom) + 1);
      } else if (mod && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        store.set(A.sidebarOpenAtom, !store.get(A.sidebarOpenAtom));
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        splitPane(store, "row");
      } else if (mod && e.key === "[") {
        e.preventDefault();
        history.back();
      } else if (mod && e.key === "]") {
        e.preventDefault();
        history.forward();
      } else if (e.key === "Escape") {
        store.set(A.paletteOpenAtom, false);
        store.set(A.highlightAtom, null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}

import { useStore } from "jotai";
import { useEffect, useRef } from "react";
import { closeOthers, closeTab, inEditable, reopenTab, splitPane } from "../lib/ui";
import { inDrafts } from "../lib/drafts";
import { useWorkspace } from "./useWorkspace";
import * as A from "../state/atoms";
import { reviewScreenAtom, versionScreenAtom } from "../state/review";

// 入力欄以外で選択中のテキストを検索語プリフィル用に取得する。
//
// 本文の編集面（contentEditable）は入力欄として扱わない。読むときは選んだ
// 文字がそのまま検索語になるのに、編集面では拾えないのは食い違う。
function selectionText(): string {
  const at = document.activeElement as HTMLElement | null;
  const typing =
    !!at &&
    (at.tagName === "INPUT" ||
      at.tagName === "TEXTAREA" ||
      !!at.closest?.(".cm-editor, .mg-block-cm, .mg-cm"));
  if (typing) return "";
  const s = window.getSelection?.()?.toString().trim() ?? "";
  return s.length > 0 && s.length <= 200 ? s : "";
}

export function useHotkeys() {
  const store = useStore();
  // 新しいメモを作る口。効果の依存を増やさないよう控えから呼ぶ。
  const { newDraft } = useWorkspace();
  const draft = useRef(newDraft);
  draft.current = newDraft;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // プレビュー（非編集）で本文を選択して Backspace/Delete を押すと、
      // WKWebView の既定動作で「戻る」が発火し、直前に見ていた別ファイルへ
      // 切り替わってしまう。編集欄の外では既定動作を抑止する。
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        !mod &&
        !inEditable(e.target)
      ) {
        e.preventDefault();
        return;
      }
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
      } else if (mod && !e.shiftKey && (e.key === "d" || e.key === "D")) {
        // ⌘B は太字だけに使う。押し間違いで左のペインが開閉しないように、
        // 開閉はここへ移した（編集面の中でだけ譲る作りだと、書いていない
        // ときに太字のつもりで押してペインが動く）。
        e.preventDefault();
        store.set(A.sidebarOpenAtom, !store.get(A.sidebarOpenAtom));
      } else if (mod && e.shiftKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        // 下書きには指摘が付かないので、一覧も開かない。
        if (inDrafts(store.get(A.soleAtom), store.get(A.draftsDirAtom))) return;
        // 版の履歴を開いていたら閉じる。どちらも本文の代わりに出す画面なので、
        // 重ねると片方が後ろで開いたままになる。
        store.set(versionScreenAtom, null);
        store.set(reviewScreenAtom, true);
      } else if (mod && e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        reopenTab(store);
      } else if (mod && !e.shiftKey && (e.key === "n" || e.key === "N")) {
        // ⌘N: 保存先の決まっていないメモを作って開く。
        e.preventDefault();
        void draft.current();
      } else if (mod && e.shiftKey && (e.key === "m" || e.key === "M")) {
        // ⌘⇧M: メタ情報の小窓。活きているペインの分だけ開け閉めする。
        e.preventDefault();
        const id = store.get(A.activePaneIdAtom);
        store.set(A.metaOpenAtom, store.get(A.metaOpenAtom) === id ? null : id);
      } else if (mod && e.altKey && e.code === "KeyW") {
        // ⌘⌥W: 見ている 1 枚だけ残す。⌥ を挟むと key は記号になるので code で見る。
        e.preventDefault();
        const paneId = store.get(A.activePaneIdAtom);
        const pane = store.get(A.panesAtom).find((p) => p.id === paneId);
        if (pane) closeOthers(store, paneId, pane.active);
      } else if (mod && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        const paneId = store.get(A.activePaneIdAtom);
        const pane = store.get(A.panesAtom).find((p) => p.id === paneId);
        if (pane && pane.tabs.length > 0) closeTab(store, paneId, pane.active);
      } else if (mod && e.key === "/") {
        e.preventDefault();
        store.set(A.shortcutsOpenAtom, !store.get(A.shortcutsOpenAtom));
      } else if (mod && e.key === ",") {
        e.preventDefault();
        store.set(A.settingsOpenAtom, !store.get(A.settingsOpenAtom));
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
        store.set(A.shortcutsOpenAtom, false);
        store.set(A.settingsOpenAtom, false);
        store.set(A.highlightAtom, null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}

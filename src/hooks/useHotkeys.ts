import { useStore } from "jotai";
import { useEffect, useRef } from "react";
import { closeAll, closeOthers, closeTab, inEditable, reopenTab, splitPane } from "../lib/ui";
import { RAIL_ROOM } from "../lib/sidebar";
import { delimOf } from "../lib/csv";
import { isJsonPath } from "../lib/jsonTree";
import { inDrafts } from "../lib/drafts";
import { useWorkspace } from "./useWorkspace";
import * as A from "../state/atoms";
import { barAtom, barTarget } from "../state/workspaceBar";
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

// 右の欄は、窓が狭いときと分割中は出せない（本文と欄のどちらも読めなくなる）。
function railRoom(panes: number): boolean {
  return panes <= 1 && window.matchMedia?.(RAIL_ROOM).matches === true;
}

export function useHotkeys() {
  const store = useStore();
  // 新しいメモを作る口。効果の依存を増やさないよう控えから呼ぶ。
  const { newDraft, openWorkspace } = useWorkspace();
  const openRef = useRef(openWorkspace);
  openRef.current = openWorkspace;
  const draft = useRef(newDraft);
  draft.current = newDraft;

  useEffect(() => {
    // 見た目を切り替えられるファイル（CSV・TSV と JSON）を出しているか。
    const switchable = (): "csv" | "json" | null => {
      const pane = store.get(A.panesAtom).find((p) => p.id === store.get(A.activePaneIdAtom));
      const path = pane?.tabs[pane.active];
      if (!path) return null;
      if (delimOf(path) !== null) return "csv";
      return isJsonPath(path) ? "json" : null;
    };
    const onKey = (e: KeyboardEvent) => {
      // ⌘1〜9 はツールバーの札の位置へ（⌘9 は一番右）。書いている最中でも
      // 効かせる（編集面はこの組を使っていない）。
      if (e.metaKey && !e.ctrlKey && !e.altKey) {
        const go = (id: string | undefined) => {
          const ws = id
            ? (store.get(A.workspacesAtom).find((w) => w.id === id) ??
              (store.get(A.workspaceAtom)?.id === id ? store.get(A.workspaceAtom) : null))
            : null;
          if (ws && ws.id !== store.get(A.workspaceAtom)?.id) void openRef.current(ws);
        };
        if (!e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
          e.preventDefault();
          go(barTarget(store.get(barAtom), Number(e.code.slice(5))));
          return;
        }
      }
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
      if (mod && !e.shiftKey && (e.key === "o" || e.key === "O")) {
        // ⌘O: 開くものを選ぶ画面。フォルダと 1 枚のファイルをここで選ぶ。
        e.preventDefault();
        store.set(A.openPickerAtom, !store.get(A.openPickerAtom));
      } else if (mod && (e.key === "p" || e.key === "P") && !e.defaultPrevented) {
        // ⌘P はファイルだけ、⌘⇧P は操作とファイルを並べる一覧。同じ一覧なので、
        // 開いているときに別のほうを押すと並べるものを替える。コメントを書いている
        // 欄では ⌘⇧P が下書きのプレビューなので、そちらが受けたら（defaultPrevented）開かない。
        e.preventDefault();
        const mode = e.shiftKey ? "all" : "files";
        const open = store.get(A.paletteOpenAtom);
        if (open && store.get(A.paletteModeAtom) === mode) {
          store.set(A.paletteOpenAtom, false);
        } else {
          store.set(A.paletteModeAtom, mode);
          store.set(A.paletteOpenAtom, true);
        }
      } else if (mod && !e.shiftKey && !e.altKey && e.code === "KeyJ") {
        // ⌘J: ワークスペースの一覧。名前で絞り込んで、Enter で移る。
        e.preventDefault();
        store.set(A.workspaceSwitcherOpenAtom, !store.get(A.workspaceSwitcherOpenAtom));
      } else if (e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.code === "KeyE") {
        // ⌃E は文中で行末へ移るキーなので、⌘ だけで受ける。
        // ⌘E: 閲覧と編集を切り替える。書いている最中でも効かせる（編集から出る口）。
        e.preventDefault();
        store.set(A.liveEditAtom, !store.get(A.liveEditAtom));
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
      } else if (mod && e.shiftKey && (e.key === "o" || e.key === "O")) {
        // ⌘⇧O: 目次。出ているときにもう一度押すと畳む。
        e.preventDefault();
        if (!railRoom(store.get(A.panesAtom).length)) return;
        store.set(A.railAtom, store.get(A.railAtom) === "toc" ? "none" : "toc");
      } else if (mod && e.shiftKey && (e.key === "k" || e.key === "K")) {
        // ⌘⇧K: コメントの欄。目次と同じ場所を取り合うので、置き換わる。
        e.preventDefault();
        if (!railRoom(store.get(A.panesAtom).length)) return;
        store.set(
          A.railAtom,
          store.get(A.railAtom) === "comments" ? "none" : "comments",
        );
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
      } else if (mod && !e.shiftKey && (e.key === "t" || e.key === "T")) {
        // ⌘T: ワークスペースを作るメニュー（札の ＋ と同じもの）。
        e.preventDefault();
        if (store.get(A.newWorkspaceAtom)) {
          store.set(A.newWorkspaceAtom, null);
          return;
        }
        const add = document.querySelector(".mg-ws-pill-add")?.getBoundingClientRect();
        store.set(
          A.newWorkspaceAtom,
          add
            ? { left: add.left, top: add.bottom + 6 }
            : { left: Math.max(16, window.innerWidth / 2 - 220), top: 56 },
        );
      } else if (mod && !e.shiftKey && (e.key === "n" || e.key === "N")) {
        // ⌘N: 保存先の決まっていないメモを作って開く。
        e.preventDefault();
        void draft.current();
      } else if (mod && e.shiftKey && (e.key === "v" || e.key === "V") && switchable()) {
        // ⌘⇧V: CSV・TSV は原文と表、JSON は木と原文を替える。出しているのが
        // それらのときだけ受ける（ほかでは書式を落とした貼り付けとして編集面へ通す）。
        e.preventDefault();
        if (switchable() === "csv") {
          store.set(A.csvViewAtom, store.get(A.csvViewAtom) === "table" ? "rainbow" : "table");
        } else {
          store.set(A.jsonViewAtom, store.get(A.jsonViewAtom) === "tree" ? "source" : "tree");
        }
      } else if (mod && e.shiftKey && (e.key === "m" || e.key === "M")) {
        // ⌘⇧M: メタ情報の小窓。活きているペインの分だけ開け閉めする。
        e.preventDefault();
        const id = store.get(A.activePaneIdAtom);
        store.set(A.metaOpenAtom, store.get(A.metaOpenAtom) === id ? null : id);
      } else if (mod && e.shiftKey && e.code === "KeyW") {
        // ⌘⇧W: そのペインのタブをすべて閉じる。
        e.preventDefault();
        closeAll(store, store.get(A.activePaneIdAtom));
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
        // ⌘/: 設定のキー操作の面。開いていれば閉じる。
        e.preventDefault();
        const showing =
          store.get(A.settingsOpenAtom) && store.get(A.settingsFaceAtom) === "keys";
        store.set(A.settingsFaceAtom, "keys");
        store.set(A.settingsOpenAtom, !showing);
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
        store.set(A.settingsOpenAtom, false);
        store.set(A.highlightAtom, null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}

import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Landing } from "./components/Landing";
import { PaneGroup } from "./components/PaneGroup";
import { Sidebar } from "./components/Sidebar";
import { ReviewScreen } from "./components/review/ReviewScreen";
import { Toolbar } from "./components/Toolbar";
import { UpdateBanner } from "./components/UpdateBanner";
import { useHotkeys } from "./hooks/useHotkeys";
import { useUrlSync } from "./hooks/useUrlSync";
import { useReviewLedger } from "./hooks/useReviewLedger";
import { useWatcher } from "./hooks/useWatcher";
import { folderDisplayName } from "./lib/idb";
import { setWindowTitle } from "./lib/windows";
import {
  activeFolderIdAtom,
  activePaneIdAtom,
  foldersAtom,
  layoutAtom,
  savedLayoutsAtom,
  sidebarOpenAtom,
  themeAtom,
} from "./state/atoms";
import { reviewScreenAtom } from "./state/review";

export default function App() {
  const activeFolderId = useAtomValue(activeFolderIdAtom);
  const folders = useAtomValue(foldersAtom);
  const sidebarOpen = useAtomValue(sidebarOpenAtom);
  const theme = useAtomValue(themeAtom);
  const layout = useAtomValue(layoutAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  const reviewOpen = useAtomValue(reviewScreenAtom);
  const store = useStore();

  useHotkeys();
  useWatcher();
  useUrlSync();
  useReviewLedger();

  // テーマを html 要素に反映
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // ドラッグ&ドロップの取りこぼしで WebView が既定動作（ドロップされたパスへ
  // ナビゲーション→リロード＝画面全体が真っ白）になるのを全域で抑止する。
  // 個別のドロップ処理は要素側で先に実行されるため影響しない。
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  // リンククリックの安全ネット: 未処理の外部リンクは opener で開き、
  // それ以外のナビゲーション（生HTML内の相対リンク等）は抑止して
  // WebView 遷移（=全画面白）を防ぐ。
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as
        | HTMLAnchorElement
        | null;
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (/^(https?:|mailto:|tel:)/.test(href)) {
        e.preventDefault();
        void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(href));
      } else if (href && !href.startsWith("#")) {
        e.preventDefault(); // アプリ外/相対への遷移は抑止
      }
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  // 分割レイアウトをフォルダごとに永続化（保存先はウィンドウごとに分かれている）
  useEffect(() => {
    if (!activeFolderId) return;
    store.set(savedLayoutsAtom, (prev) => ({
      ...prev,
      [activeFolderId]: { layout, active: activePaneId },
    }));
  }, [layout, activePaneId, activeFolderId, store]);

  // ウィンドウのタイトルは開いているフォルダ名。macOS はこれを Dock メニューの
  // ウィンドウ一覧にそのまま並べるので、どのウィンドウが何かを名前で選べる。
  useEffect(() => {
    const entry = folders.find((f) => f.id === activeFolderId);
    const title = entry ? folderDisplayName(entry) : "mdglow";
    void setWindowTitle(title).catch((e: unknown) => {
      console.error("ウィンドウのタイトルを設定できません", e);
    });
  }, [activeFolderId, folders]);

  if (!activeFolderId) {
    return (
      <div className="h-screen w-screen bg-[var(--mg-bg)] text-[var(--mg-fg)]">
        <Landing />
        <UpdateBanner />
      </div>
    );
  }

  // レビューは専用画面。読書ビューに重ねると差分を並べて見せられない。
  if (reviewOpen) {
    return (
      <>
        <ReviewScreen />
        <UpdateBanner />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--mg-bg)] text-[var(--mg-fg)]">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <div className="w-72 shrink-0">
            <Sidebar />
          </div>
        )}
        <PaneGroup />
      </div>
      <CommandPalette />
      <UpdateBanner />
    </div>
  );
}

import { useAtomValue, useStore } from "jotai";
import { useEffect, useMemo } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Settings } from "./components/Settings";
import { Shortcuts } from "./components/Shortcuts";
import { Landing } from "./components/Landing";
import { PaneGroup } from "./components/PaneGroup";
import { Sidebar } from "./components/Sidebar";
import { ReviewScreen } from "./components/review/ReviewScreen";
import { VersionScreen } from "./components/version/VersionScreen";
import { Toolbar } from "./components/Toolbar";
import { Icon } from "./components/Icon";
import { Toast } from "./components/Toast";
import { UpdateBanner } from "./components/UpdateBanner";
import { useAfterPaint } from "./hooks/useAfterPaint";
import { useDragging } from "./hooks/useDragging";
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
  sessionLayoutsAtom,
  sidebarOpenAtom,
  themeAtom,
} from "./state/atoms";
import { reviewScreenAtom, versionScreenAtom } from "./state/review";

export default function App() {
  const activeFolderId = useAtomValue(activeFolderIdAtom);
  const folders = useAtomValue(foldersAtom);
  const sidebarOpen = useAtomValue(sidebarOpenAtom);
  const theme = useAtomValue(themeAtom);
  const layout = useAtomValue(layoutAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  const reviewOpen = useAtomValue(reviewScreenAtom);
  const versionFile = useAtomValue(versionScreenAtom);
  const store = useStore();

  useHotkeys();
  useDragging();
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

  // 分割レイアウトをフォルダごとに永続化（保存先はウィンドウごとに分かれている）。
  // ウィンドウを問わない控えにも同じものを書く。新しいウィンドウで同じフォルダを
  // 開いたときや、ウィンドウの名前が変わったときの戻り先になる。
  useEffect(() => {
    if (!activeFolderId) return;
    const entry = { layout, active: activePaneId };
    store.set(savedLayoutsAtom, (prev) => ({ ...prev, [activeFolderId]: entry }));
    store.set(sessionLayoutsAtom, (prev) => ({ ...prev, [activeFolderId]: entry }));
  }, [layout, activePaneId, activeFolderId, store]);

  // ウィンドウのタイトルは開いているフォルダ名。macOS はこれを Dock メニューの
  // ウィンドウ一覧にそのまま並べるので、どのウィンドウが何かを名前で選べる。
  useEffect(() => {
    const entry = folders.find((f) => f.id === activeFolderId);
    const title = entry ? folderDisplayName(entry) : "fude";
    void setWindowTitle(title).catch((e: unknown) => {
      console.error("ウィンドウのタイトルを設定できません", e);
    });
  }, [activeFolderId, folders]);

  // どの画面を出すか。押した瞬間の値と、実際に組む値を分ける。
  const want = useMemo(
    () => ({
      landing: !activeFolderId,
      version: versionFile,
      review: reviewOpen,
    }),
    [activeFolderId, versionFile, reviewOpen],
  );
  const drawn = useAfterPaint(want);
  const screen = drawn ?? want;
  const switching = drawn !== want;

  return (
    <>
      {screen.landing ? (
        <div className="h-screen w-screen bg-[var(--mg-bg)] text-[var(--mg-fg)]">
          <Landing />
        </div>
      ) : screen.version !== null ? (
        // バージョンの履歴は専用画面。前と後を並べるので、読む画面の幅には
        // 収まらない。
        <VersionScreen path={screen.version} />
      ) : screen.review ? (
        // レビューも専用画面。読書ビューに重ねると差分を並べて見せられない。
        <ReviewScreen />
      ) : (
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
          <Shortcuts />
          <Settings />
        </div>
      )}
      {/* 画面を入れ替えているあいだの覆い。
          入れ替えは重い（本文の組み立て、指摘の一覧の突き合わせ）。押した一枚で
          やると、React は組み終わるまでコミットせず、ブラウザはコミットまで
          塗れないので、押した手応えがまるで無い。覆いだけを先に重ねる。 */}
      {switching && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[var(--mg-bg)]">
          <Icon
            name="progress_activity"
            size={22}
            className="mg-spin text-[var(--mg-muted)]"
          />
        </div>
      )}
      <UpdateBanner />
      <Toast />
    </>
  );
}

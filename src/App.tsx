import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useRef } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Settings } from "./components/Settings";
import { Shortcuts } from "./components/Shortcuts";
import { Landing } from "./components/Landing";
import { PaneGroup } from "./components/PaneGroup";
import { Sidebar } from "./components/Sidebar";
import { SidebarGrip } from "./components/SidebarGrip";
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
import { setNotionKeys } from "./lib/md/inputRules";
import { useWatcher } from "./hooks/useWatcher";
import { folderDisplayName } from "./lib/idb";
import { MIN_DOC, SIDEBAR_MIN } from "./lib/sidebar";
import { setWindowTitle } from "./lib/windows";
import {
  activeFolderIdAtom,
  activePaneIdAtom,
  foldersAtom,
  layoutAtom,
  savedLayoutsAtom,
  sessionLayoutsAtom,
  sidebarOpenAtom,
  sidebarWidthAtom,
  notionKeysAtom,
  themeAtom,
} from "./state/atoms";
import { reviewScreenAtom, versionScreenAtom } from "./state/review";

export default function App() {
  const activeFolderId = useAtomValue(activeFolderIdAtom);
  const folders = useAtomValue(foldersAtom);
  const sidebarOpen = useAtomValue(sidebarOpenAtom);
  const [sideWidth, setSideWidth] = useAtom(sidebarWidthAtom);
  // 掴んでいるあいだは仕切りが幅を直に書く（状態を通すと木全体が描き直される）。
  const sideRef = useRef<HTMLDivElement>(null);
  const theme = useAtomValue(themeAtom);
  const notionKeys = useAtomValue(notionKeysAtom);
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

  // 打ち込みの規則は打鍵のたびに走るので、設定は編集面の外から渡しておく。
  useEffect(() => {
    setNotionKeys(notionKeys);
  }, [notionKeys]);

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

  // どの画面を出すか。
  //
  // 読む画面は出しっぱなしにして、重ねる画面（コメント・バージョン）が出て
  // いるあいだは隠すだけにする。組み立て直すと、戻ってくるのに本文の組み立てと
  // 編集面の構築で 0.5 秒かかる。
  //
  // 見せる / 隠すは押した瞬間の値で決め、木から外すのは塗った後の値で決める。
  // 閉じた一枚では class の付け替えだけが起き、重ねた画面の片付けは次の一枚へ
  // 移る。
  //
  // 隠すのは visibility。display を落とすと箱が消え、隠れているあいだに
  // 走った測り直し（コメントの印の位置）が 0 になる。
  const over = versionFile !== null || reviewOpen;
  const want = useMemo(
    () => ({ version: versionFile, review: reviewOpen }),
    [versionFile, reviewOpen],
  );
  const drawn = useAfterPaint(want);
  const shown = drawn ?? want;
  const versionPath = want.version ?? shown.version;
  // 開くほうは新しく組むので待たせる。閉じるほうは待たせない。
  const opening = drawn !== want && over;

  return (
    <>
      {activeFolderId === null ? (
        <div className="h-screen w-screen bg-[var(--mg-bg)] text-[var(--mg-fg)]">
          <Landing />
        </div>
      ) : (
        <div
          className={`flex h-screen w-screen flex-col overflow-hidden bg-[var(--mg-bg)] text-[var(--mg-fg)] ${
            over ? "invisible" : ""
          }`}
        >
          <Toolbar />
          <div className="flex min-h-0 flex-1">
            {sidebarOpen && (
              <>
                {/* 幅は掴んで変えられる。窓を狭めたときに本文が 0 にならないよう、
                    上限を入れ物への割合で置く（割合は flex の入れ物の内側幅に
                    対して解ける）。min-width は max-width より優先されるので、
                    極端に狭い窓でも字が読める幅は残る。 */}
                <div
                  ref={sideRef}
                  style={{
                    width: sideWidth,
                    minWidth: SIDEBAR_MIN,
                    maxWidth: `calc(100% - ${MIN_DOC}px)`,
                  }}
                  className="shrink-0"
                >
                  <Sidebar />
                </div>
                <SidebarGrip
                  target={sideRef}
                  width={sideWidth}
                  onWidth={setSideWidth}
                />
              </>
            )}
            <PaneGroup />
          </div>
          <CommandPalette />
          <Shortcuts />
          <Settings />
        </div>
      )}

      {/* バージョンの履歴は専用画面。前と後を並べるので、読む画面の幅には
          収まらない。隠しているあいだも同じファイルを持ち続ける（閉じた
          瞬間に道筋が消えると、片付けが押した一枚に戻ってくる）。 */}
      {versionPath !== null && (
        <div
          className={`fixed inset-0 z-50 ${want.version === null ? "invisible" : ""}`}
        >
          <VersionScreen path={versionPath} />
        </div>
      )}

      {/* コメントも専用画面。読む画面に重ねると差分を並べて見せられない。 */}
      {(want.review || shown.review) && (
        <div className={`fixed inset-0 z-50 ${want.review ? "" : "invisible"}`}>
          <ReviewScreen />
        </div>
      )}

      {/* 重ねる画面を組んでいるあいだの覆い。
          組み立ては重い（本文の組み立て、指摘の一覧の突き合わせ）。押した一枚で
          やると、React は組み終わるまでコミットせず、ブラウザはコミットまで
          塗れないので、押した手応えがまるで無い。覆いだけを先に重ねる。 */}
      {opening && (
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

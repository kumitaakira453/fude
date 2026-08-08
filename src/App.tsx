import { useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import {
  activeFolderIdAtom,
  activePaneIdAtom,
  layoutAtom,
  savedLayoutsAtom,
  sidebarOpenAtom,
  themeAtom,
} from "./state/atoms";
import { useWatcher } from "./hooks/useWatcher";
import { useHotkeys } from "./hooks/useHotkeys";
import { useUrlSync } from "./hooks/useUrlSync";
import { Landing } from "./components/Landing";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { PaneGroup } from "./components/PaneGroup";
import { CommandPalette } from "./components/CommandPalette";

export default function App() {
  const activeFolderId = useAtomValue(activeFolderIdAtom);
  const sidebarOpen = useAtomValue(sidebarOpenAtom);
  const theme = useAtomValue(themeAtom);
  const layout = useAtomValue(layoutAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  const store = useStore();

  useHotkeys();
  useWatcher();
  useUrlSync();

  // テーマを html 要素に反映
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // 分割レイアウトをフォルダごとに永続化
  useEffect(() => {
    if (!activeFolderId) return;
    store.set(savedLayoutsAtom, (prev) => ({
      ...prev,
      [activeFolderId]: { layout, active: activePaneId },
    }));
  }, [layout, activePaneId, activeFolderId, store]);

  if (!activeFolderId) {
    return (
      <div className="h-screen w-screen bg-[var(--mg-bg)] text-[var(--mg-fg)]">
        <Landing />
      </div>
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
    </div>
  );
}

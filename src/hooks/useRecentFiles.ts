import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import * as A from "../state/atoms";

// 今見ているファイルが替わるたびに、そのファイルを見た時刻を控える。
export function useRecentFiles(): void {
  const store = useStore();
  const pane = useAtomValue(A.activePaneAtom);
  const shown = A.activePath(pane);
  useEffect(() => {
    if (!shown) return;
    const next = new Map(store.get(A.recentFilesAtom));
    next.set(shown, Date.now());
    store.set(A.recentFilesAtom, next);
  }, [shown, store]);
}

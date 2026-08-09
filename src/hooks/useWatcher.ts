import { useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import { watch, type UnwatchFn } from "@tauri-apps/plugin-fs";
import * as A from "../state/atoms";
import { isMarkdown } from "../lib/fsAccess";
import { useWorkspace } from "./useWorkspace";

// Tauri の OS ネイティブ file watcher でアクティブフォルダを監視し、変更を即反映する。
export function useWatcher() {
  const store = useStore();
  const activeFolderId = useAtomValue(A.activeFolderIdAtom);
  const { getRootPath, reloadFile, refreshTreeStructure } = useWorkspace();

  useEffect(() => {
    const root = getRootPath();
    if (!root) return;

    let disposed = false;
    let unwatch: UnwatchFn | null = null;
    let treeTimer: number | undefined;
    const scheduleTreeRefresh = () => {
      window.clearTimeout(treeTimer);
      treeTimer = window.setTimeout(() => {
        if (!disposed) void refreshTreeStructure();
      }, 400);
    };

    watch(
      root,
      (event) => {
        if (disposed) return;
        const known = new Set(store.get(A.filesAtom).map((f) => f.path));
        let structural = false;
        for (const abs of event.paths) {
          if (!abs.startsWith(root)) continue;
          const rel = abs.slice(root.length + 1);
          if (isMarkdown(rel)) {
            if (known.has(rel)) void reloadFile(rel);
            else structural = true; // 新規 md
          } else {
            structural = true; // ディレクトリ変化など
          }
        }
        if (structural) scheduleTreeRefresh();
      },
      { recursive: true, delayMs: 250 },
    )
      .then((fn) => {
        if (disposed) fn();
        else {
          unwatch = fn;
          store.set(A.watchModeAtom, "observer");
        }
      })
      .catch(() => {
        store.set(A.watchModeAtom, "off");
      });

    return () => {
      disposed = true;
      window.clearTimeout(treeTimer);
      unwatch?.();
      store.set(A.watchModeAtom, "off");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolderId]);
}

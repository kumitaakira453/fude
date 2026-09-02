import { watch, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import { invalidateImage, isImage, isMarkdown } from "../lib/fsAccess";
import * as A from "../state/atoms";
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
        const touched = new Map(store.get(A.touchedAtom));
        let structural = false;
        let imageChanged = false;
        for (const abs of event.paths) {
          if (!abs.startsWith(root)) continue;
          const rel = abs.slice(root.length + 1);
          if (isMarkdown(rel)) {
            // 触られた時刻を今にしておく。クイックオープンの並び順が、
            // 外から書き換わった分（エージェントの編集など）も追いかける。
            touched.set(rel, Date.now());
            if (known.has(rel)) void reloadFile(rel);
            else structural = true; // 新規 md
          } else if (isImage(rel)) {
            // 画像が変わったらキャッシュを捨てて再取得させる
            invalidateImage(abs);
            imageChanged = true;
          } else {
            structural = true; // ディレクトリ変化など
          }
        }
        store.set(A.touchedAtom, touched);
        if (imageChanged) {
          store.set(A.assetVersionAtom, store.get(A.assetVersionAtom) + 1);
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

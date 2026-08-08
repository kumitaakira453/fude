import { useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import * as A from "../state/atoms";
import { isMarkdown } from "../lib/fsAccess";
import { useWorkspace } from "./useWorkspace";

// アクティブフォルダを監視し、変更をリアルタイムに反映する。
// FileSystemObserver（Chrome 129+）が使えればネイティブ watch、無ければポーリング。
export function useWatcher() {
  const store = useStore();
  const activeFolderId = useAtomValue(A.activeFolderIdAtom);
  const { getRootHandle, reloadFile, refreshTree } = useWorkspace();

  useEffect(() => {
    const root = getRootHandle();
    if (!root) return;

    let disposed = false;
    let treeTimer: number | undefined;
    const scheduleTreeRefresh = () => {
      window.clearTimeout(treeTimer);
      treeTimer = window.setTimeout(() => {
        if (!disposed) void refreshTree();
      }, 400);
    };

    // --- FileSystemObserver（ネイティブ監視） ---
    const Observer = window.FileSystemObserver;
    if (Observer) {
      store.set(A.watchModeAtom, "observer");
      const observer = new Observer((records) => {
        if (disposed) return;
        let structural = false;
        for (const rec of records) {
          const path = rec.relativePathComponents.join("/");
          if (rec.type === "modified" && isMarkdown(path)) {
            void reloadFile(path);
          } else if (rec.type === "appeared" || rec.type === "disappeared" || rec.type === "moved") {
            structural = true;
          } else if (rec.type === "modified" && rec.changedHandle.kind === "directory") {
            structural = true;
          }
        }
        if (structural) scheduleTreeRefresh();
      });
      observer.observe(root, { recursive: true }).catch(() => {
        // 監視に失敗したらポーリングへ切替
        if (!disposed) startPolling();
      });
      return () => {
        disposed = true;
        window.clearTimeout(treeTimer);
        observer.disconnect();
        store.set(A.watchModeAtom, "off");
      };
    }

    // --- ポーリング（フォールバック） ---
    let openTimer: number | undefined;
    let fullTimer: number | undefined;
    function startPolling() {
      store.set(A.watchModeAtom, "polling");
      // 開いているファイルは高頻度で mtime を確認
      const checkOpen = async () => {
        const panes = store.get(A.panesAtom);
        const mtime = store.get(A.mtimeCacheAtom);
        const files = store.get(A.filesAtom);
        const paths = [...new Set(panes.map((p) => p.path).filter((p): p is string => !!p))];
        for (const path of paths) {
          const node = files.find((f) => f.path === path);
          if (!node) continue;
          try {
            const file = await (node.handle as FileSystemFileHandle).getFile();
            if (file.lastModified !== mtime.get(path)) await reloadFile(path);
          } catch {
            /* noop */
          }
        }
      };
      openTimer = window.setInterval(() => void checkOpen(), 1500);
      fullTimer = window.setInterval(() => void refreshTree(), 8000);
    }
    startPolling();

    const onFocus = () => store.get(A.watchModeAtom) === "polling" && scheduleTreeRefresh();
    window.addEventListener("focus", onFocus);

    return () => {
      disposed = true;
      window.clearTimeout(treeTimer);
      window.clearInterval(openTimer);
      window.clearInterval(fullTimer);
      window.removeEventListener("focus", onFocus);
      store.set(A.watchModeAtom, "off");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolderId]);
}

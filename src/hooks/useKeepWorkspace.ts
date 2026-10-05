import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import { currentWindowLabel } from "../lib/windows";
import { bindWindow } from "../lib/workspaces";
import * as A from "../state/atoms";
import {
  flushWorkspaceSave,
  scheduleWorkspaceSave,
  upsertWorkspace,
} from "../state/workspace";

// 開いているワークスペースに、タブの並びと木の開閉を控える。
//
// 控えるのは、並びがそのワークスペースのものになってから（layoutOwner）。
// 開いた直後の空の並びを書くと、控えていたタブが消える。
//
// 何も開いていない画面（スタート画面）へ戻ったら、この窓はワークスペースを
// 開いていないことにする。起動し直したときに、閉じたつもりのものが戻らない。
export function useKeepWorkspace(): void {
  const store = useStore();
  const layout = useAtomValue(A.layoutAtom);
  const activePane = useAtomValue(A.activePaneIdAtom);
  const owner = useAtomValue(A.layoutOwnerAtom);
  const expandedByKey = useAtomValue(A.expandedByFolderAtom);
  const activeFolderId = useAtomValue(A.activeFolderIdAtom);

  useEffect(() => {
    const ws = store.get(A.workspaceAtom);
    if (!ws || owner !== ws.id) return;
    const next = {
      ...ws,
      layout,
      active: activePane,
      expanded: expandedByKey[ws.id] ?? ws.expanded,
    };
    store.set(A.workspaceAtom, next);
    store.set(A.workspacesAtom, (list) => upsertWorkspace(list, next));
    scheduleWorkspaceSave(next);
  }, [store, layout, activePane, owner, expandedByKey]);

  useEffect(() => {
    if (activeFolderId !== null || !store.get(A.workspaceAtom)) return;
    flushWorkspaceSave();
    store.set(A.workspaceAtom, null);
    store.set(A.layoutOwnerAtom, null);
    void bindWindow(currentWindowLabel(), null).catch(() => {});
  }, [store, activeFolderId]);

  // 窓を閉じる・読み込み直すときは、待っている分を書き出しておく。
  useEffect(() => {
    const flush = () => flushWorkspaceSave();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);
}

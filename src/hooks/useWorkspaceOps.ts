import { useStore } from "jotai";
import { useCallback } from "react";
import { claudeSessionFiles, FIRST_TABS, type ClaudeSession, type Wrote } from "../lib/claude";
import { pickDirectory, rootOf } from "../lib/fsAccess";
import { dirOf } from "../lib/paths";
import { registerFolder, rootName } from "../lib/idb";
import { remapLeafPaths } from "../lib/ui";
import { currentWindowLabel, openWorkspaceWindow } from "../lib/windows";
import {
  deleteWorkspace as dropWorkspaceFile,
  focusWorkspace,
  freeColor,
  newWorkspaceId,
  saveWorkspace,
  type Workspace,
  type WorkspaceColor,
} from "../lib/workspaces";
import * as A from "../state/atoms";
import { notify, notifyBusy, settle } from "../state/toast";
import { upsertWorkspace } from "../state/workspace";
import { useWorkspace } from "./useWorkspace";

// ワークスペースそのものの操作（作る・名前・色・根の出し入れ・消す）。
// 開く・切り替えるのは useWorkspace の openWorkspace。

const nowMs = () => Math.floor(performance.timeOrigin + performance.now());

export function useWorkspaceOps() {
  const store = useStore();
  const { openWorkspace, refreshTree } = useWorkspace();

  // 控えと一覧を書き換える。この窓で開いているものなら、開いている方も。
  const put = useCallback(
    (ws: Workspace) => {
      store.set(A.workspacesAtom, (list) => upsertWorkspace(list, ws));
      if (store.get(A.workspaceAtom)?.id === ws.id) store.set(A.workspaceAtom, ws);
      void saveWorkspace(ws).catch((e: unknown) => {
        console.error("ワークスペースを控えられません", e);
      });
    },
    [store],
  );

  const find = useCallback(
    (id: string) =>
      (store.get(A.workspaceAtom)?.id === id ? store.get(A.workspaceAtom) : null) ??
      store.get(A.workspacesAtom).find((w) => w.id === id) ??
      null,
    [store],
  );

  // 新しく作って開く。copy を立てると今のタブの並びと根を写す（作業の途中で
  // 用途が分かれたとき）。立てなければ、選んだフォルダ 1 つで始める。
  const createWorkspace = useCallback(
    async (opts: { name?: string; copy?: boolean; newWindow?: boolean } = {}) => {
      const now = nowMs();
      const current = store.get(A.workspaceAtom);
      let roots: string[];
      if (opts.copy && current) {
        roots = [...current.roots];
      } else {
        const dir = await pickDirectory();
        if (!dir) return;
        roots = [dir];
        void registerFolder(dir, now).then((list) => store.set(A.foldersAtom, list));
      }
      const folders = store.get(A.foldersAtom);
      const ws: Workspace = {
        id: newWorkspaceId(now),
        name:
          opts.name?.trim() ||
          (opts.copy && current ? `${current.name} のコピー` : rootName(folders, roots[0])),
        color: freeColor(store.get(A.workspacesAtom)),
        roots,
        lastOpened: now,
        ...(opts.copy && current
          ? { layout: store.get(A.layoutAtom), active: store.get(A.activePaneIdAtom) }
          : {}),
      };
      put(ws);
      if (opts.newWindow) await openWorkspaceWindow(ws.id, ws.name);
      else await openWorkspace(ws);
      return ws;
    },
    [store, put, openWorkspace],
  );

  const renameWorkspace = useCallback(
    (id: string, name: string) => {
      const ws = find(id);
      const trimmed = name.trim();
      if (!ws || !trimmed || trimmed === ws.name) return;
      // 自分で付け直した名前は、Claude のセッションの名前に追わせない。
      put({
        ...ws,
        name: trimmed,
        ...(ws.claude ? { claude: { ...ws.claude, nameFollows: false } } : {}),
      });
    },
    [find, put],
  );

  const recolorWorkspace = useCallback(
    (id: string, color: WorkspaceColor) => {
      const ws = find(id);
      if (ws && ws.color !== color) put({ ...ws, color });
    },
    [find, put],
  );

  // 開いているワークスペースの根を並べ直して、木を取り直す。
  const setRoots = useCallback(
    async (ws: Workspace, roots: string[]) => {
      const next: Workspace = {
        ...ws,
        roots,
        // 元のフォルダを外したら、もう「そのフォルダのワークスペース」ではない。
        folder: ws.folder && roots.includes(ws.folder) ? ws.folder : undefined,
      };
      put(next);
      store.set(A.activeFolderIdAtom, roots[0]);
      store.set(A.extraRootsAtom, roots.slice(1));
      await refreshTree();
    },
    [store, put, refreshTree],
  );

  // 今のワークスペースにフォルダを足す。
  const addRoot = useCallback(async () => {
    const ws = store.get(A.workspaceAtom);
    if (!ws) return;
    const dir = await pickDirectory();
    if (!dir) return;
    if (ws.roots.some((r) => dir === r || dir.startsWith(`${r}/`))) {
      notify(store, "そのフォルダはもう並んでいます");
      return;
    }
    void registerFolder(dir, nowMs()).then((list) => store.set(A.foldersAtom, list));
    // 足したフォルダは開いた状態で出す。
    store.set(A.expandedByFolderAtom, (prev) => ({
      ...prev,
      [ws.id]: [...new Set([...(prev[ws.id] ?? []), ...ws.roots, dir])],
    }));
    await setRoots(ws, [...ws.roots, dir]);
  }, [store, setRoots]);

  // 今のワークスペースから根を外す。最後の 1 つは外さない。その根のタブは閉じる。
  const removeRoot = useCallback(
    async (root: string) => {
      const ws = store.get(A.workspaceAtom);
      if (!ws || ws.roots.length <= 1 || !ws.roots.includes(root)) return;
      remapLeafPaths(store, (p) => (p.startsWith(`${root}/`) ? null : p));
      await setRoots(
        ws,
        ws.roots.filter((r) => r !== root),
      );
    },
    [store, setRoots],
  );

  // 消す。開いている窓があれば、その窓を前に出して知らせるだけにする
  // （開いているものを黙って消すと、その窓の控えがまた書き戻される）。
  const deleteWorkspace = useCallback(
    async (id: string): Promise<boolean> => {
      if (store.get(A.workspaceAtom)?.id === id) {
        notify(store, "開いているワークスペースは消せません。別のものに切り替えてから消してください");
        return false;
      }
      if (await focusWorkspace(id, currentWindowLabel()).catch(() => false)) {
        notify(store, "別の窓で開いています。その窓を閉じてから消してください");
        return false;
      }
      store.set(A.workspacesAtom, (list) => list.filter((w) => w.id !== id));
      await dropWorkspaceFile(id).catch((e: unknown) => {
        console.error("ワークスペースを消せません", e);
      });
      return true;
    },
    [store],
  );

  // Claude のセッションからワークスペースを作って開く（ベータ）。
  //
  // 根は、書いたファイルを含む登録済みのフォルダ。どれにも入らなければ
  // セッションの作業フォルダ。タブには書いたものを新しい順にいくつか並べる。
  const createFromSession = useCallback(
    async (session: ClaudeSession): Promise<void> => {
      const transcript = session.transcript;
      if (!transcript) {
        notify(store, "このセッションの記録が見つかりません");
        return;
      }
      const at = notifyBusy(store, "セッションが書いたファイルを読んでいます…");
      let wrote: Wrote[];
      try {
        ({ wrote } = await claudeSessionFiles(session.sessionId, transcript));
        settle(store, at, `${wrote.length} 件のファイルを見つけました`);
      } catch (e) {
        settle(store, at, "セッションの記録を読めませんでした");
        console.error("セッションの記録を読めません", e);
        return;
      }
      const folders = store.get(A.foldersAtom).map((f) => f.path);
      const roots: string[] = [];
      for (const w of wrote) {
        const root = rootOf(folders, w.path);
        if (root && !roots.includes(root)) roots.push(root);
      }
      if (roots.length === 0 && session.cwd) roots.push(session.cwd);
      if (roots.length === 0 && wrote[0]) roots.push(dirOf(wrote[0].path));
      if (roots.length === 0) {
        notify(store, "並べるフォルダが決まりません");
        return;
      }
      const tabs = wrote.slice(0, FIRST_TABS).map((w) => w.path);
      const now = nowMs();
      const ws: Workspace = {
        id: newWorkspaceId(now),
        name: session.name.trim() || "Claude のセッション",
        color: freeColor(store.get(A.workspacesAtom)),
        roots,
        lastOpened: now,
        ...(tabs.length > 0
          ? { layout: { kind: "leaf", id: "p1", tabs, active: 0 }, active: "p1" }
          : {}),
        claude: {
          sessionId: session.sessionId,
          nameFollows: true,
          lastName: session.name.trim() || undefined,
          transcript,
          wrote,
        },
      };
      put(ws);
      await openWorkspace(ws);
    },
    [store, put, openWorkspace],
  );

  // セッションとの結びつきを外して、ふつうのワークスペースにする。
  const unlinkSession = useCallback(
    (id: string) => {
      const ws = find(id);
      if (!ws?.claude) return;
      const { claude: _drop, ...rest } = ws;
      put(rest);
    },
    [find, put],
  );

  // 新しい窓で開く（開いている窓があれば前に出す）。
  const openInNewWindow = useCallback(
    async (ws: Workspace) => {
      if (await focusWorkspace(ws.id, "").catch(() => false)) return;
      await openWorkspaceWindow(ws.id, ws.name);
    },
    [],
  );

  return {
    createWorkspace,
    renameWorkspace,
    recolorWorkspace,
    addRoot,
    removeRoot,
    deleteWorkspace,
    openInNewWindow,
    createFromSession,
    unlinkSession,
  };
}

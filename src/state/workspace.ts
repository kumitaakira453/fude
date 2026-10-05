import type { getDefaultStore } from "jotai";
import { absoluteIn } from "../lib/fsAccess";
import { absoluteLayout } from "../lib/ui";
import { rootName } from "../lib/idb";
import {
  freeColor,
  listWorkspaces,
  newWorkspaceId,
  saveWorkspace,
  type Workspace,
} from "../lib/workspaces";
import * as A from "./atoms";

type Store = ReturnType<typeof getDefaultStore>;

// 一覧の中のワークスペースを差し替える（無ければ足す）。新しく開いた順を保つ。
export function upsertWorkspace(list: readonly Workspace[], ws: Workspace): Workspace[] {
  return [ws, ...list.filter((w) => w.id !== ws.id)].sort(
    (a, b) => b.lastOpened - a.lastOpened,
  );
}

export const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

// ---- 控えの書き出し ----
//
// タブを動かすたびに書くと、ドラッグの間じゅう書き続ける。手が止まってから
// まとめて 1 回書く。切り替える前には書き切る。

const SAVE_WAIT = 500;
let pending: Workspace | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function write(ws: Workspace): void {
  void saveWorkspace(ws).catch((e: unknown) => {
    console.error("ワークスペースを控えられません", e);
  });
}

export function scheduleWorkspaceSave(ws: Workspace): void {
  pending = ws;
  clearTimeout(timer);
  timer = setTimeout(flushWorkspaceSave, SAVE_WAIT);
}

export function flushWorkspaceSave(): void {
  clearTimeout(timer);
  const ws = pending;
  pending = null;
  if (ws) write(ws);
}

// ---- フォルダのワークスペース ----

// そのフォルダを開いてできたワークスペース。無ければ作る。
//
// 一覧はこの窓の控えなので、他の窓で作ったばかりのものが載っていないことが
// ある。見つからないときだけ読み直してから作る（同じフォルダのものを 2 つ作らない）。
// 作るときは、フォルダごとに控えていたタブの並びを引き継ぐ。
export async function folderWorkspace(
  store: Store,
  path: string,
  now: number,
): Promise<Workspace> {
  const find = (list: readonly Workspace[]) => list.find((w) => w.folder === path);
  const known = find(store.get(A.workspacesAtom));
  if (known) return known;
  const fresh = await listWorkspaces().catch(() => store.get(A.workspacesAtom));
  store.set(A.workspacesAtom, fresh);
  const found = find(fresh);
  if (found) return found;
  const kept =
    store.get(A.savedLayoutsAtom)[path] ?? store.get(A.sessionLayoutsAtom)[path];
  const expanded = store.get(A.expandedByFolderAtom)[path];
  const ws: Workspace = {
    id: newWorkspaceId(now),
    name: rootName(store.get(A.foldersAtom), path),
    color: freeColor(fresh),
    roots: [path],
    folder: path,
    lastOpened: now,
    ...(kept ? { layout: absoluteLayout(kept.layout, path), active: kept.active } : {}),
    ...(expanded ? { expanded: expanded.map((p) => absoluteIn(p, path)) } : {}),
  };
  store.set(A.workspacesAtom, (list) => upsertWorkspace(list, ws));
  return ws;
}

export async function refreshWorkspaces(store: Store): Promise<void> {
  try {
    store.set(A.workspacesAtom, await listWorkspaces());
  } catch (e) {
    console.error("ワークスペースの一覧を読めません", e);
  }
}

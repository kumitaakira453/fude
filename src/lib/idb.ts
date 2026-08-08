import { get, set, del } from "idb-keyval";

// 登録フォルダ（履歴）。ディレクトリハンドルは構造化クローンで IndexedDB に保存できる。
export interface FolderEntry {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  lastOpened: number;
}

const KEY = "mdglow:folders";

export async function loadFolders(): Promise<FolderEntry[]> {
  const list = (await get<FolderEntry[]>(KEY)) ?? [];
  return list.sort((a, b) => b.lastOpened - a.lastOpened);
}

export async function saveFolders(list: FolderEntry[]): Promise<void> {
  await set(KEY, list);
}

// 同一ハンドルは isSameEntry で重複判定し、既存なら lastOpened だけ更新する。
export async function registerFolder(
  handle: FileSystemDirectoryHandle,
  now: number,
): Promise<FolderEntry[]> {
  const list = await loadFolders();
  for (const entry of list) {
    if (await entry.handle.isSameEntry(handle)) {
      entry.lastOpened = now;
      entry.name = handle.name;
      await saveFolders(list);
      return list.sort((a, b) => b.lastOpened - a.lastOpened);
    }
  }
  const entry: FolderEntry = {
    id: `${handle.name}-${now}`,
    name: handle.name,
    handle,
    lastOpened: now,
  };
  const next = [entry, ...list];
  await saveFolders(next);
  return next;
}

export async function removeFolder(id: string): Promise<FolderEntry[]> {
  const list = (await loadFolders()).filter((f) => f.id !== id);
  await saveFolders(list);
  return list;
}

export async function clearFolders(): Promise<void> {
  await del(KEY);
}

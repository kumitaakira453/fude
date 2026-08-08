import { get, set, del } from "idb-keyval";

// 登録フォルダ（履歴）。Tauri では絶対パス文字列で管理する。
export interface FolderEntry {
  id: string; // = 絶対パス（安定）
  name: string; // ベース名
  path: string; // 絶対パス
  lastOpened: number;
  alias?: string; // ユーザー任意の表示名
}

// 表示名: エイリアスがあればそれ、無ければベース名。
export function folderDisplayName(f: FolderEntry): string {
  const a = f.alias?.trim();
  return a || f.name;
}

const KEY = "mdglow:folders";

function basename(p: string): string {
  const parts = p.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

export async function loadFolders(): Promise<FolderEntry[]> {
  const list = (await get<FolderEntry[]>(KEY)) ?? [];
  return list.sort((a, b) => b.lastOpened - a.lastOpened);
}

export async function saveFolders(list: FolderEntry[]): Promise<void> {
  await set(KEY, list);
}

export async function registerFolder(path: string, now: number): Promise<FolderEntry[]> {
  const list = await loadFolders();
  const existing = list.find((f) => f.path === path);
  if (existing) {
    existing.lastOpened = now;
    existing.name = basename(path);
    await saveFolders(list);
    return list.sort((a, b) => b.lastOpened - a.lastOpened);
  }
  const entry: FolderEntry = { id: path, name: basename(path), path, lastOpened: now };
  const next = [entry, ...list];
  await saveFolders(next);
  return next;
}

export async function renameFolder(id: string, alias: string): Promise<FolderEntry[]> {
  const list = await loadFolders();
  const e = list.find((f) => f.id === id);
  if (e) {
    const a = alias.trim();
    e.alias = a || undefined;
    await saveFolders(list);
  }
  return list.sort((a, b) => b.lastOpened - a.lastOpened);
}

export async function removeFolder(id: string): Promise<FolderEntry[]> {
  const list = (await loadFolders()).filter((f) => f.id !== id);
  await saveFolders(list);
  return list;
}

export async function clearFolders(): Promise<void> {
  await del(KEY);
}

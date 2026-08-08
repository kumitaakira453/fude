// File System Access API まわりのユーティリティ。
// サーバを持たず、ブラウザだけでローカルフォルダを走査・読込する。

export const MD_EXTENSIONS = [".md", ".markdown", ".mdx", ".mdown", ".mkd"];

export interface TreeNode {
  name: string;
  path: string; // ルートからの相対パス（/ 区切り）
  kind: "file" | "dir";
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  children?: TreeNode[];
}

export function isFsAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase();
  return MD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    // @ts-expect-error showDirectoryPicker は一部 TS lib に未収録
    const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
      mode: "read",
    });
    return handle;
  } catch (e) {
    // ユーザーがキャンセルした場合など
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

export async function verifyPermission(
  handle: FileSystemDirectoryHandle,
  request: boolean,
): Promise<boolean> {
  const opts = { mode: "read" as const };
  // @ts-expect-error queryPermission は一部 TS lib に未収録
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if (!request) return false;
  // @ts-expect-error requestPermission は一部 TS lib に未収録
  return (await handle.requestPermission(opts)) === "granted";
}

// ディレクトリを再帰走査して md ファイルのツリーを構築する。
// md を1つも含まないディレクトリは省く。隠しディレクトリ・node_modules 等はスキップ。
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".obsidian",
  ".trash",
  ".vscode",
  ".idea",
  "dist",
  "build",
]);

export async function buildTree(
  dir: FileSystemDirectoryHandle,
  parentPath = "",
): Promise<TreeNode[]> {
  const nodes: TreeNode[] = [];
  // @ts-expect-error entries() の型が lib に無い場合がある
  for await (const [name, handle] of dir.entries()) {
    const path = parentPath ? `${parentPath}/${name}` : name;
    if (handle.kind === "directory") {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      const children = await buildTree(handle as FileSystemDirectoryHandle, path);
      if (children.length > 0) {
        nodes.push({ name, path, kind: "dir", handle, children });
      }
    } else if (isMarkdown(name)) {
      nodes.push({ name, path, kind: "file", handle: handle as FileSystemFileHandle });
    }
  }
  // ディレクトリ優先 → 名前順（数値を考慮した自然順）
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, "ja", { numeric: true });
  });
  return nodes;
}

// ツリーを平坦化してファイルだけの配列にする（検索・クイックオープン用）。
export function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.kind === "file") out.push(n);
      else if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export interface FileData {
  text: string;
  lastModified: number;
}

export async function readFile(handle: FileSystemFileHandle): Promise<FileData> {
  const file = await handle.getFile();
  return { text: await file.text(), lastModified: file.lastModified };
}

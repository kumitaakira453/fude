// Tauri ネイティブ FS 経由でローカルフォルダを走査・読込する。
// ブラウザの File System Access API は使わない（許可プロンプト不要・絶対パス取得可）。
import { readDir, readTextFile, stat } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";

export const MD_EXTENSIONS = [".md", ".markdown", ".mdx", ".mdown", ".mkd"];

export interface TreeNode {
  name: string;
  path: string; // ルートからの相対パス（/ 区切り）
  abs: string; // 絶対パス
  kind: "file" | "dir";
  children?: TreeNode[];
}

export function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase();
  return MD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// フォルダ選択ダイアログ（ネイティブ）。選択した絶対パスを返す。
export async function pickDirectory(): Promise<string | null> {
  const sel = await open({ directory: true, multiple: false, title: "Markdown フォルダを選択" });
  return typeof sel === "string" ? sel : null;
}

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

// ディレクトリを再帰走査して md ファイルのツリーを構築する。
export async function buildTree(rootAbs: string, parentRel = ""): Promise<TreeNode[]> {
  const dirAbs = parentRel ? `${rootAbs}/${parentRel}` : rootAbs;
  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    entries = await readDir(dirAbs);
  } catch {
    return [];
  }
  const nodes: TreeNode[] = [];
  for (const e of entries) {
    const rel = parentRel ? `${parentRel}/${e.name}` : e.name;
    const abs = `${rootAbs}/${rel}`;
    if (e.isDirectory) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      const children = await buildTree(rootAbs, rel);
      if (children.length > 0) nodes.push({ name: e.name, path: rel, abs, kind: "dir", children });
    } else if (e.isFile && isMarkdown(e.name)) {
      nodes.push({ name: e.name, path: rel, abs, kind: "file" });
    }
  }
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, "ja", { numeric: true });
  });
  return nodes;
}

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

export async function readFile(abs: string): Promise<FileData> {
  const text = await readTextFile(abs);
  let lastModified = 0;
  try {
    const s = await stat(abs);
    lastModified = s.mtime ? new Date(s.mtime).getTime() : 0;
  } catch {
    /* mtime 取得失敗は無視 */
  }
  return { text, lastModified };
}

// 画像などローカル資産を webview で表示可能な URL（asset://）に変換する。
export function assetUrl(abs: string): string {
  return convertFileSrc(abs);
}

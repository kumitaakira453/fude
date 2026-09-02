// Tauri ネイティブ FS 経由でローカルフォルダを走査・読込する。
// ブラウザの File System Access API は使わない（許可プロンプト不要・絶対パス取得可）。
import { open } from "@tauri-apps/plugin-dialog";
import {
  exists,
  mkdir,
  readFile as readBinaryFile,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export const MD_EXTENSIONS = [".md", ".markdown", ".mdx", ".mdown", ".mkd"];

// 画面に出す名前。Markdown の拡張子は落とす。パスを渡してもよい。
export function displayName(nameOrPath: string): string {
  const base = nameOrPath.split("/").pop() ?? nameOrPath;
  const lower = base.toLowerCase();
  const ext = MD_EXTENSIONS.find((e) => lower.endsWith(e));
  return ext ? base.slice(0, -ext.length) : base;
}

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
  const sel = await open({
    directory: true,
    multiple: false,
    title: "Markdown フォルダを選択",
  });
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
export async function buildTree(
  rootAbs: string,
  parentRel = "",
): Promise<TreeNode[]> {
  const dirAbs = parentRel ? `${rootAbs}/${parentRel}` : rootAbs;
  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    entries = await readDir(dirAbs);
  } catch {
    return [];
  }
  const nodes: TreeNode[] = [];
  const dirs: typeof entries = [];
  for (const e of entries) {
    const rel = parentRel ? `${parentRel}/${e.name}` : e.name;
    const abs = `${rootAbs}/${rel}`;
    if (e.isDirectory) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      dirs.push(e);
    } else if (e.isFile && isMarkdown(e.name)) {
      nodes.push({ name: e.name, path: rel, abs, kind: "file" });
    }
  }
  // 同じ階層のフォルダは並べて読む。1 つずつ待つと、フォルダの数だけ
  // 往復が直列に積み上がり、開くまでに何秒もかかる。
  const walked = await Promise.all(
    dirs.map(async (e) => {
      const rel = parentRel ? `${parentRel}/${e.name}` : e.name;
      // 空フォルダも表示する（新規作成フォルダや構成用フォルダのため）
      return {
        name: e.name,
        path: rel,
        abs: `${rootAbs}/${rel}`,
        kind: "dir" as const,
        children: await buildTree(rootAbs, rel),
      };
    }),
  );
  nodes.push(...walked);
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

// 名前かパスに文字列を含むファイルだけを残す。中身が残ったフォルダだけを通す。
export function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  if (!q) return nodes;
  const lower = q.toLowerCase();
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.kind === "file") {
      if (
        n.name.toLowerCase().includes(lower) ||
        n.path.toLowerCase().includes(lower)
      )
        out.push(n);
    } else if (n.children) {
      const children = filterTree(n.children, q);
      if (children.length) out.push({ ...n, children });
    }
  }
  return out;
}

// 相対パスで 1 つ引く。
export function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.kind === "dir" && n.children && path.startsWith(`${n.path}/`)) {
      const hit = findNode(n.children, path);
      if (hit) return hit;
    }
  }
  return null;
}

// フォルダの中身。空文字はルートを指す。フォルダ以外を渡したら空。
export function childrenAt(nodes: TreeNode[], dirPath: string): TreeNode[] {
  if (!dirPath) return nodes;
  const node = findNode(nodes, dirPath);
  if (!node || node.kind !== "dir") return [];
  return node.children ?? [];
}

// 祖先のパスを浅い方から並べる。自分自身は含めない。
export function ancestorPaths(path: string): string[] {
  const segs = path.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join("/"));
  return out;
}

// パスの 1 つ上のフォルダ。ルート直下なら空文字。
export function parentPath(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

export interface FileData {
  text: string;
  lastModified: number;
}

// ---- 書き込み系（編集・ファイル操作） ----
export async function writeFile(abs: string, text: string): Promise<void> {
  await writeTextFile(abs, text);
}
export async function createDir(abs: string): Promise<void> {
  await mkdir(abs, { recursive: true });
}
export async function removePath(
  abs: string,
  recursive: boolean,
): Promise<void> {
  await remove(abs, { recursive });
}
export async function renamePath(
  oldAbs: string,
  newAbs: string,
): Promise<void> {
  await rename(oldAbs, newAbs);
}
export async function pathExists(abs: string): Promise<boolean> {
  try {
    return await exists(abs);
  } catch {
    return false;
  }
}

// フォルダ配下の Markdown の更新時刻。走査は Rust 側で完結し、1 回の呼び出しで
// 全部返る。ファイルごとに stat を投げると、数百ファイルで往復が積み上がる。
export async function folderMtimes(rootAbs: string): Promise<Map<string, number>> {
  const { invoke } = await import("@tauri-apps/api/core");
  const list = await invoke<{ path: string; mtime: number }[]>("folder_mtimes", {
    root: rootAbs,
  });
  return new Map(list.map((f) => [f.path, f.mtime]));
}

// 全文検索インデックス用。mtime を使わない経路では stat を省いて IPC を半減させる。
export async function readText(abs: string): Promise<string> {
  return readTextFile(abs);
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

// 画像などローカル資産を fs 経由でバイト読みして blob URL 化する。
// asset:// プロトコルはスコープの都合で先頭ドットのパスを弾くため、fs 読みに統一。
const IMG_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
};
const imgCache = new Map<string, string>();

export function peekImageUrl(abs: string): string | null {
  return imgCache.get(abs) ?? null;
}

// 拡張子が画像かどうか
export function isImage(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ext in IMG_MIME;
}

// ファイルが変わった時にキャッシュを破棄し、次回 imageUrl で再読込させる。
export function invalidateImage(abs: string): void {
  const url = imgCache.get(abs);
  if (url) {
    URL.revokeObjectURL(url);
    imgCache.delete(abs);
  }
}

export async function imageUrl(abs: string): Promise<string | null> {
  const cached = imgCache.get(abs);
  if (cached) return cached;
  try {
    const ext = abs.split(".").pop()?.toLowerCase() ?? "";
    const bytes = await readBinaryFile(abs);
    const blob = new Blob([bytes], {
      type: IMG_MIME[ext] ?? "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    imgCache.set(abs, url);
    return url;
  } catch {
    return null;
  }
}

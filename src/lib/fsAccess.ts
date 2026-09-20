// Tauri ネイティブ FS 経由でローカルフォルダを走査・読込する。
// ブラウザの File System Access API は使わない（許可プロンプト不要・絶対パス取得可）。
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  exists,
  mkdir,
  readFile as readBinaryFile,
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

// Markdown を 1 枚だけ選ぶダイアログ。フォルダを開かずに読むときの入口。
export async function pickMarkdownFile(): Promise<string | null> {
  const sel = await open({
    multiple: false,
    title: "Markdown ファイルを選択",
    filters: [
      { name: "Markdown", extensions: MD_EXTENSIONS.map((e) => e.slice(1)) },
    ],
  });
  return typeof sel === "string" ? sel : null;
}

export interface Crumb {
  name: string;
  // その区切りまでの道筋。押したときに開く階層を決める。
  path: string;
  // 先頭側を畳んだ印。
  folded?: boolean;
}

// 道筋を区切りに割る。keep を超える分は、先頭側を「…」1 つに畳む。
// 絶対パスは先頭の / を保つ。畳むのは、末尾のファイル名を必ず見せるため。
export function crumbsOf(path: string, keep = Infinity): Crumb[] {
  const abs = path.startsWith("/");
  const segs = path.split("/").filter(Boolean);
  const upto = (n: number) => (abs ? "/" : "") + segs.slice(0, n).join("/");
  const all: Crumb[] = segs.map((name, i) => ({ name, path: upto(i + 1) }));
  if (all.length <= keep) return all;
  const cut = all.length - keep;
  return [{ name: "…", path: upto(cut), folded: true }, ...all.slice(cut)];
}

// 1 階層だけ読む。木を持っていないとき（1 枚だけ開いているとき）に、
// 道筋のプルダウンでその場の中身を出すために使う。道筋は絶対パスで持つ。
export async function readLevel(
  dirAbs: string,
  sieve: Sieve = MARKDOWN_SIEVE,
  ignore = "",
): Promise<TreeNode[]> {
  const base = dirAbs === "/" ? "" : dirAbs;
  const nodes = await scan(dirAbs, sieve, ignore, 1);
  const out = nodes.map((entry) => ({
    name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
    path: `${base}/${entry.path}`,
    abs: `${base}/${entry.path}`,
    kind: entry.dir ? ("dir" as const) : ("file" as const),
    ...(entry.dir ? { children: [] } : {}),
  }));
  sortNodes(out);
  return out;
}

// 1 枚だけ開くときのファイル一覧。親フォルダを root に据え、その 1 枚しか
// 置かない（走査しない）。相対リンクと相対画像は root 基準で解ける。
export function soleTree(abs: string): { root: string; node: TreeNode } {
  const cut = abs.replace(/[/\\]+$/, "").lastIndexOf("/");
  const root = cut > 0 ? abs.slice(0, cut) : "/";
  const name = abs.slice(cut + 1);
  return { root, node: { name, path: name, abs, kind: "file" } };
}

// 走査へ渡す、拡張子だけの粗いふるい。only があればその拡張子だけ、skip が
// あればその拡張子以外が返る。一覧に何を出すかの決めごとは呼び出し側が持つ。
export interface Sieve {
  only?: string[];
  skip?: string[];
}

export const MARKDOWN_SIEVE: Sieve = {
  only: MD_EXTENSIONS.map((ext) => ext.slice(1)),
};

interface ScanEntry {
  path: string;
  dir: boolean;
}

// 走査は Rust に任せる。階層ごとに読み出しを投げると往復が階層の数だけ積み上がり、
// 一覧に出さないファイルまで WebView へ渡ってメインスレッドが塞がる（ビルド成果物を
// 抱えたフォルダでは 4 万件のうち 9 割が捨てる分になる）。一覧から外したものは
// 走査にも入らないので、索引にも載らない。
async function scan(
  rootAbs: string,
  sieve: Sieve,
  ignore: string,
  depth: number,
): Promise<ScanEntry[]> {
  try {
    return await invoke<ScanEntry[]>("scan_tree", {
      root: rootAbs,
      only: sieve.only ?? [],
      skip: sieve.skip ?? [],
      ignore,
      depth,
    });
  } catch {
    return [];
  }
}

// ディレクトリを走査してツリーを構築する。
export async function buildTree(
  rootAbs: string,
  sieve: Sieve = MARKDOWN_SIEVE,
  ignore = "",
): Promise<TreeNode[]> {
  const began = performance.now();
  const entries = await scan(rootAbs, sieve, ignore, 0);
  const tree = nestEntries(entries, rootAbs);
  const took = performance.now() - began;
  if (import.meta.env.DEV && took > 200) {
    console.info(`scan_tree ${Math.round(took)}ms`, {
      root: rootAbs,
      scanned: entries.length,
    });
  }
  return tree;
}

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, "ja", { numeric: true });
  });
  for (const node of nodes) if (node.children) sortNodes(node.children);
}

// 走査が返した平らな並びを木に組む。親は子より先に来るので、順に積める。
export function nestEntries(entries: ScanEntry[], rootAbs: string): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();
  for (const entry of entries) {
    const cut = entry.path.lastIndexOf("/");
    const node: TreeNode = {
      name: entry.path.slice(cut + 1),
      path: entry.path,
      abs: `${rootAbs}/${entry.path}`,
      kind: entry.dir ? "dir" : "file",
      // 空フォルダも表示する（新規作成フォルダや構成用フォルダのため）
      ...(entry.dir ? { children: [] } : {}),
    };
    if (entry.dir) dirs.set(entry.path, node);
    const parent = cut === -1 ? null : dirs.get(entry.path.slice(0, cut));
    (parent?.children ?? roots).push(node);
  }
  sortNodes(roots);
  return roots;
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
export async function folderMtimes(
  rootAbs: string,
  ignore = "",
): Promise<Map<string, number>> {
  const list = await invoke<{ path: string; mtime: number }[]>("folder_mtimes", {
    root: rootAbs,
    ignore,
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
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
};

// 画像の拡張子（点なし）。ダイアログの絞り込みに使う。
export const IMAGE_EXTENSIONS = Object.keys(IMG_MIME);

// 種別から拡張子を引く。貼り付けた画像には名前が無いので、ここから補う。
// 同じ種別に複数の綴りがあるもの（jpg / jpeg）は先に並べたほうを返す。
export function extForMime(mime: string | null): string | null {
  if (!mime) return null;
  const want = mime.toLowerCase().split(";")[0].trim();
  return IMAGE_EXTENSIONS.find((ext) => IMG_MIME[ext] === want) ?? null;
}
const imgCache = new Map<string, string>();

export function peekImageUrl(abs: string): string | null {
  return imgCache.get(abs) ?? null;
}

// 拡張子が画像かどうか。点から始まる形で見る（"png" という名前は画像ではない）。
export function isImage(path: string): boolean {
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
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

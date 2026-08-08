import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { TreeNode } from "../lib/fsAccess";
import type { FolderEntry } from "../lib/idb";

// ---- ワークスペース ----
export const foldersAtom = atom<FolderEntry[]>([]); // 登録フォルダ（履歴）
export const activeFolderIdAtom = atom<string | null>(null);
export const treeAtom = atom<TreeNode[]>([]);
export const filesAtom = atom<TreeNode[]>([]); // ツリーを平坦化したファイル一覧
export const loadingAtom = atom<{ active: boolean; message: string; done: number; total: number }>({
  active: false,
  message: "",
  done: 0,
  total: 0,
});

// path -> 生テキスト。ペイン表示と全文検索で共有する。
export const contentCacheAtom = atom<Map<string, string>>(new Map());
// path -> lastModified（ポーリング差分検出用）
export const mtimeCacheAtom = atom<Map<string, number>>(new Map());

// ---- ペイン（画面分割：二分木グリッド） ----
export interface Pane {
  id: string;
  path: string | null;
}
// レイアウトツリー: leaf=ペイン, split=分割ノード（子を row/col で並べる）
export interface LeafNode {
  kind: "leaf";
  id: string;
  path: string | null;
}
export interface SplitNode {
  kind: "split";
  id: string;
  dir: "row" | "col";
  sizes: number[]; // 子の比率（合計 1）
  children: LayoutNode[];
}
export type LayoutNode = LeafNode | SplitNode;

export const layoutAtom = atom<LayoutNode>({ kind: "leaf", id: "p1", path: null });
export const activePaneIdAtom = atom<string>("p1");

// フォルダごとに分割レイアウトを永続化（リロード/再オープンで復元）
// getOnInit: true = 命令的 store.get でも localStorage を同期読みする
export const savedLayoutsAtom = atomWithStorage<
  Record<string, { layout: LayoutNode; active: string }>
>("mdglow:layouts", {}, undefined, { getOnInit: true });

// ペイン（leaf）の最大数
export const MAX_PANES = 6;

function collectLeaves(node: LayoutNode): LeafNode[] {
  return node.kind === "leaf" ? [node] : node.children.flatMap(collectLeaves);
}

// 既存コード互換: leaf 一覧を Pane[] として公開（読み取り専用の導出）
export const panesAtom = atom<Pane[]>((get) => collectLeaves(get(layoutAtom)));

export const activePaneAtom = atom((get) => {
  const panes = get(panesAtom);
  const id = get(activePaneIdAtom);
  return panes.find((p) => p.id === id) ?? panes[0];
});

// ---- UI / テーマ（永続化） ----
export const themeAtom = atomWithStorage<string>("mdglow:theme", "aurora");
export const fontAtom = atomWithStorage<string>("mdglow:font", "sans");
export const readingWidthAtom = atomWithStorage<"cozy" | "wide" | "full">(
  "mdglow:width",
  "cozy",
);
export const sidebarOpenAtom = atomWithStorage<boolean>("mdglow:sidebar", true);
export const tocOpenAtom = atomWithStorage<boolean>("mdglow:toc", true);

// ---- ファイルツリー開閉状態（フォルダ ID ごとに永続化） ----
export const expandedByFolderAtom = atomWithStorage<Record<string, string[]>>(
  "mdglow:expanded",
  {},
);

// ---- 検索・パレット ----
export const treeFilterAtom = atom<string>("");
export const sidebarTabAtom = atom<"files" | "search">("files");
export const paletteOpenAtom = atom<boolean>(false);

// ---- 監視状態 ----
export const watchModeAtom = atom<"observer" | "polling" | "off">("off");

// ---- 本文内ハイライト（検索ヒットからのジャンプ） ----
export interface Highlight {
  term: string;
  caseSensitive: boolean;
  useRegex: boolean;
  nonce: number; // 同じ語で再ジャンプさせるための識別子
}
export const highlightAtom = atom<Highlight | null>(null);

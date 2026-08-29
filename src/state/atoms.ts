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
// 1 つのペインは複数のファイルをタブとして持ち、そのうち 1 つを表示する。
export interface Pane {
  id: string;
  tabs: string[]; // 開いているファイル（ルートからの相対パス）
  active: number; // tabs 内の位置
}
// レイアウトツリー: leaf=ペイン, split=分割ノード（子を row/col で並べる）
export interface LeafNode {
  kind: "leaf";
  id: string;
  tabs: string[];
  active: number;
}
export interface SplitNode {
  kind: "split";
  id: string;
  dir: "row" | "col";
  sizes: number[]; // 子の比率（合計 1）
  children: LayoutNode[];
}
export type LayoutNode = LeafNode | SplitNode;

export const layoutAtom = atom<LayoutNode>({ kind: "leaf", id: "p1", tabs: [], active: 0 });
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

// ペインが今表示しているファイル。タブが無ければ null。
export function activePath(pane: Pane | LeafNode | undefined): string | null {
  return pane?.tabs[pane.active] ?? null;
}

// ---- UI / テーマ（永続化） ----
export const themeAtom = atomWithStorage<string>("mdglow:theme", "aurora");
export const fontAtom = atomWithStorage<string>("mdglow:font", "sans");
export const readingWidthAtom = atomWithStorage<"cozy" | "wide" | "full">(
  "mdglow:width",
  "cozy",
);
export const sidebarOpenAtom = atomWithStorage<boolean>("mdglow:sidebar", true);
export const tocOpenAtom = atomWithStorage<boolean>("mdglow:toc", true);
// エディトリアル組版（ベータ）: 構造を読み取って組版を強化する描画モード
export const editorialAtom = atomWithStorage<boolean>("mdglow:editorial", true);

// 更新チェック: nonce をインクリメントで手動トリガ、状態を UI で共有する
export const updateCheckNonceAtom = atom(0);
export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "uptodate"
  | "error";
export const updateStatusAtom = atom<UpdateStatus>("idle");

// ---- ファイルツリー開閉状態（フォルダ ID ごとに永続化） ----
export const expandedByFolderAtom = atomWithStorage<Record<string, string[]>>(
  "mdglow:expanded",
  {},
);

// ---- ツリーで対象を表示（パンくずクリック等） ----
// path のフォルダ/ファイルをツリー上で展開・スクロール・強調するための信号
export const revealInTreeAtom = atom<{ path: string; nonce: number } | null>(
  null,
);

// ---- 検索・パレット ----
export const treeFilterAtom = atom<string>("");
export const sidebarTabAtom = atom<"files" | "search">("files");
export const paletteOpenAtom = atom<boolean>(false);

// ---- 監視状態 ----
export const watchModeAtom = atom<"observer" | "polling" | "off">("off");
// 画像が変更されたら増える。MdImage はこれを見て再取得する。
export const assetVersionAtom = atom<number>(0);

// ---- 戻る/進むの可否 ----
export const canBackAtom = atom<boolean>(false);
export const canForwardAtom = atom<boolean>(false);

// ---- 本文内ハイライト（検索ヒットからのジャンプ） ----
export interface Highlight {
  term: string;
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean; // 単語単位（サイドバー検索と本文ハイライトを一致させる）
  nonce: number; // 同じ語で再ジャンプさせるための識別子
}
export const highlightAtom = atom<Highlight | null>(null);

// ---- 検索パネル（共有クエリ / フォーカス要求 / アクティブヒット指定） ----
// クエリを共有化することで ⌘F 押下時に選択語をプリフィルできる
export const searchQueryAtom = atom<string>("");
// 入力欄にフォーカス＋全選択を要求する（nonce を増やすたびに発火）
export const searchFocusNonceAtom = atom<number>(0);
// 検索結果の表示形式（フラットなファイル別リスト / ディレクトリツリー）
export const searchViewAtom = atom<"list" | "tree">("list");
// ⌘F: アクティブなペインのファイル内検索ウィジェットを開いてフォーカスする要求
export const docFindNonceAtom = atom<number>(0);
// ファイル内検索ウィジェットの表示状態（⌘F で true、⌘⇧F やサイドバー操作で false）
export const docFindOpenAtom = atom<boolean>(false);
// 検索結果リストのナビゲーションで「このファイルの N 番目のヒットへ」を本文側へ伝える
export interface SearchActiveHit {
  path: string;
  hitIndex: number; // ファイル内の 0 始まりヒット順
  nonce: number;
}
export const searchActiveHitAtom = atom<SearchActiveHit | null>(null);

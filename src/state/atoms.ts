import { atom } from "jotai";
import { atomFamily, atomWithStorage } from "jotai/utils";
import type { TreeNode } from "../lib/fsAccess";
import type { DocEntry, FolderEntry } from "../lib/idb";
import { REVIEW_SIDE_WIDTH, SIDEBAR_WIDTH } from "../lib/sidebar";
import { windowScopedKey } from "../lib/windows";

// ---- ワークスペース ----
export const foldersAtom = atom<FolderEntry[]>([]); // 登録フォルダ（履歴）
export const activeFolderIdAtom = atom<string | null>(null);
// フォルダを開かずに 1 枚だけ読んでいるときの、そのファイルの絶対パス。
// 親フォルダが activeFolderId に入るが、履歴には登録しない。
export const soleAtom = atom<string | null>(null);
export const recentDocsAtom = atom<DocEntry[]>([]); // 1 枚で開いたファイル（履歴）
export const treeAtom = atom<TreeNode[]>([]);
export const filesAtom = atom<TreeNode[]>([]); // ツリーを平坦化したファイル一覧
export const loadingAtom = atom<{ active: boolean; message: string; done: number; total: number }>({
  active: false,
  message: "",
  done: 0,
  total: 0,
});

// 作ったばかりのファイル。開いた先で焦点を入れるのに 1 度だけ使う。
// 既存のファイルを開くときは入れない（読むつもりのときに見ていた場所が動く）。
export const freshFileAtom = atom<string | null>(null);

// path -> 生テキスト。ペイン表示と全文検索で共有する。
export const contentCacheAtom = atom<Map<string, string>>(new Map());
// path -> lastModified（ポーリング差分検出用）
export const mtimeCacheAtom = atom<Map<string, number>>(new Map());
// path -> 最後に触られた時刻。フォルダを開いたときにまとめて読み、監視で
// 変更を拾うたびに更新する。クイックオープンの並び順に使う。
export const touchedAtom = atom<Map<string, number>>(new Map());

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

// フォルダごとに分割レイアウトを永続化（リロード/再オープンで復元）。
// キーはウィンドウごとに分ける。同じフォルダを 2 つのウィンドウで開いたときに、
// 互いのレイアウトを上書きし合わないようにする。
// getOnInit: true = 命令的 store.get でも localStorage を同期読みする
export const savedLayoutsAtom = atomWithStorage<
  Record<string, { layout: LayoutNode; active: string }>
>(windowScopedKey("mdglow:layouts"), {}, undefined, { getOnInit: true });

// ウィンドウを跨いだ控え。上のキーはウィンドウごとに分かれているので、
// 新しいウィンドウで同じフォルダを開くと復元先が無い。フォルダを開いた
// ときに最後の状態へ戻れるよう、ウィンドウを問わない控えも持っておく。
export const sessionLayoutsAtom = atomWithStorage<
  Record<string, { layout: LayoutNode; active: string }>
>("mdglow:sessions", {}, undefined, { getOnInit: true });

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
// 「この path がいま出しているファイルか」を path ごとに引く。
//
// 行がこれを購読すると、選択が変わったときに起きるのは真偽が変わった 2 行
// だけになる。ペインそのものを購読すると全行が起き、1000 ファイルのフォルダ
// では押してから色が付くまで実測で 100〜200ms かかっていた。
export const isShownAtom = atomFamily((path: string) =>
  atom((get) => activePath(get(activePaneAtom)) === path),
);



// ---- UI / テーマ（永続化） ----
// 見た目の好みはアプリ全体で 1 つ。どのウィンドウで変えても揃う。
export const themeAtom = atomWithStorage<string>("mdglow:theme", "aurora");
export const fontAtom = atomWithStorage<string>("mdglow:font", "sans");
export const readingWidthAtom = atomWithStorage<"cozy" | "wide" | "full">(
  "mdglow:width",
  "cozy",
);
// エディトリアル組版（ベータ）: 構造を読み取って組版を強化する描画モード
export const editorialAtom = atomWithStorage<boolean>("mdglow:editorial", true);

// リアルタイム編集（ベータ）: どのファイルも、組版されたまま直接書ける編集面で
// 開く。切っていれば読む画面だけになり、直すのは本文のダブルクリックから。
export const liveEditAtom = atomWithStorage<boolean>("mdglow:liveedit", false);
// Markdown 以外もツリーに出すか。画像・HTML・PDF が並ぶ。切ると読み物だけの
// 見え方になる（開ける・開けないは変わらない。1 枚だけ開く経路は常に通る）。
export const showOtherFilesAtom = atomWithStorage<boolean>("mdglow:showfiles", true);
// Notion 風の打ち込み（ベータ）: `>` でトグル、`|` で引用。Markdown の書き方
// （`>` は引用）から外れるので、入れた人にだけ効かせる。
export const notionKeysAtom = atomWithStorage<boolean>("mdglow:notionkeys", false);
// 図のソース欄の幅。図の記述は 1 行が長くなりやすいので掴んで広げられる。
// 0 は「まだ動かしていない」で、窓の広さから決める。
export const mermaidPaneAtom = atomWithStorage<number>("mdglow:mmdpane", 0);

// 画面の使い方はウィンドウごと。片方でサイドバーを閉じても、もう片方は開いたまま。
export const sidebarOpenAtom = atomWithStorage<boolean>(
  windowScopedKey("mdglow:sidebar"),
  true,
);
// 左の欄の幅（画素）。掴んで変えた分を窓ごとに覚える。
export const sidebarWidthAtom = atomWithStorage<number>(
  windowScopedKey("mdglow:sidebarw"),
  SIDEBAR_WIDTH,
);
// レビュー画面の右の欄の幅。左の欄と同じく窓ごとに覚える。
export const reviewSideWidthAtom = atomWithStorage<number>(
  windowScopedKey("mdglow:reviewsidew"),
  REVIEW_SIDE_WIDTH,
);
export const tocOpenAtom = atomWithStorage<boolean>(
  windowScopedKey("mdglow:toc"),
  true,
);

// 更新チェック: nonce をインクリメントで手動トリガ、状態を UI で共有する
export const updateCheckNonceAtom = atom(0);
export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "uptodate"
  | "error";
export const updateStatusAtom = atom<UpdateStatus>("idle");

// ---- 閉じたタブの控え（⌘⇧T で開き直す） ----
// 別のペインやウィンドウへ移したものは「閉じた」ではないので積まない。
// フォルダを切り替えたら破棄する（別のフォルダのパスを開き直しても意味が無い）。
export interface ClosedTab {
  path: string;
  paneId: string;
  index: number;
}
export const closedTabsAtom = atom<ClosedTab[]>([]);

// ---- ファイルツリー開閉状態（フォルダ ID ごとに永続化・ウィンドウごと） ----
export const expandedByFolderAtom = atomWithStorage<Record<string, string[]>>(
  windowScopedKey("mdglow:expanded"),
  {},
);

// ---- ツリーで対象を表示（パンくずクリック等） ----
// path のフォルダ/ファイルをツリー上で展開・スクロール・強調するための信号。
// edit を立てると、その行をそのまま名前の変更に入れる。
export const revealInTreeAtom = atom<{
  path: string;
  nonce: number;
  edit?: boolean;
} | null>(null);

// ---- 検索・パレット ----
export const treeFilterAtom = atom<string>("");
export const sidebarTabAtom = atom<"files" | "search">("files");
export const paletteOpenAtom = atom<boolean>(false);
// ⌘/ で開くキー操作の一覧
export const shortcutsOpenAtom = atom<boolean>(false);
// ⌘, で開く表示設定
export const settingsOpenAtom = atom<boolean>(false);
// ⌘⇧M で開くメタ情報の小窓。開いているペインの id を持つ。
export const metaOpenAtom = atom<string | null>(null);

// ---- 下書き（保存先の決まっていないメモ） ----
// 置き場。起動時に 1 度だけ求める。分かるまでは下書きかどうかを判定しない。
export const draftsDirAtom = atom<string | null>(null);
// 下書きから離れようとしている。保存先を決めるか捨てるかを選ばせる小窓を出す。
// go は、どちらかを選んだあとに続ける行き先（閉じるだけなら無い）。
//
// **この欄を then という名前にしてはいけない。** jotai は atom の値に then が
// 生えていると promise と見なし、読んだ部品を Suspense で止める。止まる先が
// 無いので画面ごと消え、押しても何も起きなくなる。
export interface DraftAsk {
  path: string;
  go: (() => void) | null;
}
export const draftAskAtom = atom<DraftAsk | null>(null);

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

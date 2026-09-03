import { type getDefaultStore } from "jotai";
import * as A from "../state/atoms";
import type { LayoutNode, LeafNode, SplitNode } from "../state/atoms";

type Store = ReturnType<typeof getDefaultStore>;

let seq = 2;
const leafId = () => `p${seq++}`;
const splitId = () => `s${seq++}`;
const equal = (n: number): number[] => Array.from({ length: n }, () => 1 / n);

function countLeaves(node: LayoutNode): number {
  return node.kind === "leaf" ? 1 : node.children.reduce((s, c) => s + countLeaves(c), 0);
}

export type DropZone = "center" | "left" | "right" | "top" | "bottom";

// タブの並びと作用中の位置を整える。同じファイルは 1 つに畳み、作用中の位置は
// 必ず範囲内に収める。タブを閉じたり移動したりしても壊れた状態にならないようにする。
function leaf(id: string, tabs: string[], active: number): LeafNode {
  const unique = tabs.filter((t, i) => tabs.indexOf(t) === i);
  const at = unique.length === 0 ? 0 : Math.min(Math.max(active, 0), unique.length - 1);
  return { kind: "leaf", id, tabs: unique, active: at };
}

const emptyLeaf = (id: string): LeafNode => leaf(id, [], 0);

// 対象 leaf を dir 方向に分割する。before=true なら新ペインを手前に。
function splitLeaf(
  node: LayoutNode,
  targetId: string,
  dir: "row" | "col",
  newLeaf: LeafNode,
  before: boolean,
): LayoutNode {
  if (node.kind === "leaf") {
    if (node.id !== targetId) return node;
    const children = before ? [newLeaf, node] : [node, newLeaf];
    return { kind: "split", id: splitId(), dir, sizes: [0.5, 0.5], children };
  }
  // 同方向の split 直下に対象 leaf があれば兄弟として挿入（入れ子を避ける）
  const idx = node.children.findIndex((c) => c.kind === "leaf" && c.id === targetId);
  if (idx >= 0 && node.dir === dir) {
    const at = before ? idx : idx + 1;
    const children = [...node.children.slice(0, at), newLeaf, ...node.children.slice(at)];
    return { ...node, children, sizes: equal(children.length) };
  }
  return {
    ...node,
    children: node.children.map((c) => splitLeaf(c, targetId, dir, newLeaf, before)),
  };
}

// leaf を削除。子が1つになった split は畳む。全消しなら null。
function removeLeaf(node: LayoutNode, id: string): LayoutNode | null {
  if (node.kind === "leaf") return node.id === id ? null : node;
  const children = node.children
    .map((c) => removeLeaf(c, id))
    .filter((c): c is LayoutNode => !!c);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: equal(children.length) };
}

// 指定 leaf を書き換える。木の走査をここに集約する。
function updateLeaf(
  node: LayoutNode,
  id: string,
  change: (target: LeafNode) => LeafNode,
): LayoutNode {
  if (node.kind === "leaf") return node.id === id ? change(node) : node;
  return { ...node, children: node.children.map((c) => updateLeaf(c, id, change)) };
}

function setSizes(node: LayoutNode, id: string, sizes: number[]): LayoutNode {
  if (node.kind === "leaf") return node;
  if (node.id === id) return { ...node, sizes };
  return { ...node, children: node.children.map((c) => setSizes(c, id, sizes)) };
}

function firstLeafId(node: LayoutNode): string {
  return node.kind === "leaf" ? node.id : firstLeafId(node.children[0]);
}

function findLeaf(node: LayoutNode, id: string): LeafNode | null {
  if (node.kind === "leaf") return node.id === id ? node : null;
  for (const child of node.children) {
    const hit = findLeaf(child, id);
    if (hit) return hit;
  }
  return null;
}

// ---- 公開 API ----

// アクティブペインを dir 方向に分割（新ペインは同じファイルを複製表示 or 指定パス）。
export function splitPane(store: Store, dir: "row" | "col", path?: string) {
  const root = store.get(A.layoutAtom);
  if (countLeaves(root) >= A.MAX_PANES) return;
  const activeId = store.get(A.activePaneIdAtom);
  const active = store.get(A.panesAtom).find((p) => p.id === activeId);
  const carry = path !== undefined ? path : A.activePath(active);
  const newLeaf = leaf(leafId(), carry ? [carry] : [], 0);
  store.set(A.layoutAtom, splitLeaf(root, activeId, dir, newLeaf, false));
  store.set(A.activePaneIdAtom, newLeaf.id);
}

// ツールバー用エイリアス
export const splitInto = (store: Store, dir: "row" | "col") => splitPane(store, dir);

// アクティブペインの右に、指定ファイルで新ペインを開く。
export const openToSide = (store: Store, path: string) => splitPane(store, "row", path);

// サイドバーのツリーで対象を出す。閉じていれば開き、ファイルの面に切り替える。
// edit を立てると、その行をそのまま名前の変更に入れる。
export function revealInTree(
  store: Store,
  path: string,
  opts?: { edit?: boolean },
) {
  store.set(A.sidebarOpenAtom, true);
  store.set(A.sidebarTabAtom, "files");
  store.set(A.revealInTreeAtom, {
    path,
    nonce: Date.now(),
    edit: opts?.edit,
  });
}

// 指定ペインでファイルを開く。既にタブがあればそれを選ぶだけ。
export function openInPane(store: Store, paneId: string, path: string) {
  store.set(
    A.layoutAtom,
    updateLeaf(store.get(A.layoutAtom), paneId, (target) => {
      const at = target.tabs.indexOf(path);
      if (at >= 0) return leaf(target.id, target.tabs, at);
      // 作用中タブの直後に差し込む。関連するファイルが隣り合う。
      const tabs = [
        ...target.tabs.slice(0, target.active + 1),
        path,
        ...target.tabs.slice(target.active + 1),
      ];
      return leaf(target.id, tabs, Math.min(target.active + 1, tabs.length - 1));
    }),
  );
  store.set(A.activePaneIdAtom, paneId);
}

export function activateTab(store: Store, paneId: string, index: number) {
  store.set(
    A.layoutAtom,
    updateLeaf(store.get(A.layoutAtom), paneId, (target) => leaf(target.id, target.tabs, index)),
  );
  store.set(A.activePaneIdAtom, paneId);
}

// 閉じたタブの控え。開き直せるのは直近のいくつかで足りる。
const CLOSED_MAX = 12;

// 閉じた 1 枚を控える。別のペインやウィンドウへ移したものは「閉じた」では
// ないので、移動の経路からは remember を落として呼ぶ。
function remember(store: Store, tab: A.ClosedTab) {
  const rest = store.get(A.closedTabsAtom).filter((t) => t.path !== tab.path);
  store.set(A.closedTabsAtom, [tab, ...rest].slice(0, CLOSED_MAX));
}

export interface CloseOpts {
  // 既定は控える。⌘⇧T で開き直せるようにするため。
  remember?: boolean;
}

// タブを閉じる。最後の 1 枚を閉じたときは、他にペインがあればペインごと閉じる。
// 単一ペインのときは空のまま残す（画面が消えると戻る手段が無くなる）。
export function closeTab(
  store: Store,
  paneId: string,
  index: number,
  opts: CloseOpts = {},
) {
  const root = store.get(A.layoutAtom);
  const target = findLeaf(root, paneId);
  if (!target) return;
  const path = target.tabs[index];
  if (path && opts.remember !== false) remember(store, { path, paneId, index });
  if (target.tabs.length <= 1 && countLeaves(root) > 1) {
    closePane(store, paneId);
    return;
  }
  const tabs = target.tabs.filter((_, i) => i !== index);
  // 閉じたタブより後ろを見ていたなら 1 つ手前にずらす
  const active = index < target.active ? target.active - 1 : target.active;
  store.set(A.layoutAtom, updateLeaf(root, paneId, (t) => leaf(t.id, tabs, active)));
}

// ファイルを指して閉じる。閉じるまでに間が空く経路（別ウィンドウへ引き出す等）
// では、掴んだ時点の位置が当てにならないため、その場で探し直す。
export function closeTabAt(
  store: Store,
  paneId: string,
  path: string,
  opts: CloseOpts = {},
) {
  const target = findLeaf(store.get(A.layoutAtom), paneId);
  const index = target?.tabs.indexOf(path) ?? -1;
  if (index >= 0) closeTab(store, paneId, index, opts);
}

// 閉じたタブを開き直す（⌘⇧T）。閉じたときのペインと位置に戻す。
// そのペインが無くなっていれば今のペインへ。既に開いていれば次の控えへ進む。
// 戻り値は開き直したパス。控えが空なら null。
export function reopenTab(store: Store): string | null {
  const stack = [...store.get(A.closedTabsAtom)];
  while (stack.length > 0) {
    const tab = stack.shift() as A.ClosedTab;
    const root = store.get(A.layoutAtom);
    const pane = findLeaf(root, tab.paneId);
    const paneId = pane ? tab.paneId : store.get(A.activePaneIdAtom);
    const target = pane ?? findLeaf(root, paneId);
    if (!target || target.tabs.includes(tab.path)) continue;
    const at = Math.min(tab.index, target.tabs.length);
    const tabs = [...target.tabs.slice(0, at), tab.path, ...target.tabs.slice(at)];
    store.set(
      A.layoutAtom,
      updateLeaf(root, paneId, (t) => leaf(t.id, tabs, at)),
    );
    store.set(A.activePaneIdAtom, paneId);
    store.set(A.closedTabsAtom, stack);
    return tab.path;
  }
  store.set(A.closedTabsAtom, stack);
  return null;
}

export interface TabRef {
  paneId: string;
  index: number;
}

// タブを別のペインへ移す（同じペイン内なら並べ替え）。
export function moveTab(store: Store, from: TabRef, toPaneId: string, toIndex?: number) {
  const root = store.get(A.layoutAtom);
  const source = findLeaf(root, from.paneId);
  const path = source?.tabs[from.index];
  if (!path) return;

  if (from.paneId === toPaneId) {
    const rest = source.tabs.filter((_, i) => i !== from.index);
    const at = Math.min(toIndex ?? rest.length, rest.length);
    const tabs = [...rest.slice(0, at), path, ...rest.slice(at)];
    store.set(A.layoutAtom, updateLeaf(root, toPaneId, (t) => leaf(t.id, tabs, at)));
    store.set(A.activePaneIdAtom, toPaneId);
    return;
  }

  // 先に受け側へ入れてから送り側を削る。送り側が空になってペインごと
  // 閉じられても、移した先が残るようにするため。
  const target = findLeaf(root, toPaneId);
  if (!target) return;
  const at = Math.min(toIndex ?? target.tabs.length, target.tabs.length);
  const tabs = [...target.tabs.slice(0, at), path, ...target.tabs.slice(at)];
  store.set(
    A.layoutAtom,
    updateLeaf(root, toPaneId, (t) => leaf(t.id, tabs, tabs.indexOf(path))),
  );
  closeTab(store, from.paneId, from.index, { remember: false });
  store.set(A.activePaneIdAtom, toPaneId);
}

// ドラッグ&ドロップ: 対象ペインのゾーンに応じて開く/分割する。
// from が付いていればタブの移動、無ければファイルツリーからの新規オープン。
export function dropOnPane(
  store: Store,
  targetId: string,
  zone: DropZone,
  path: string,
  from?: TabRef,
) {
  const canSplit = countLeaves(store.get(A.layoutAtom)) < A.MAX_PANES;
  if (zone === "center" || !canSplit) {
    if (from) moveTab(store, from, targetId);
    else openInPane(store, targetId, path);
    return;
  }
  const dir: "row" | "col" = zone === "left" || zone === "right" ? "row" : "col";
  const before = zone === "left" || zone === "top";
  const newLeaf = leaf(leafId(), [path], 0);
  store.set(A.layoutAtom, splitLeaf(store.get(A.layoutAtom), targetId, dir, newLeaf, before));
  store.set(A.activePaneIdAtom, newLeaf.id);
  // 分割で新しいペインへ移した場合は、元のタブを取り除く
  if (from) closeTab(store, from.paneId, from.index);
}

// split ノードのサイズ更新（リサイザー用）。
export function updateSplitSizes(store: Store, splitNodeId: string, sizes: number[]) {
  store.set(A.layoutAtom, setSizes(store.get(A.layoutAtom), splitNodeId, sizes));
}

// ペインを閉じる。
export function closePane(store: Store, id: string) {
  // ペインごと閉じるときは、載っていたタブをまとめて控える。作用中のものが
  // 先に戻るよう、後ろから積む。
  const pane = findLeaf(store.get(A.layoutAtom), id);
  if (pane) {
    for (let i = pane.tabs.length - 1; i >= 0; i--) {
      if (i !== pane.active) remember(store, { path: pane.tabs[i], paneId: id, index: i });
    }
    const path = pane.tabs[pane.active];
    if (path) remember(store, { path, paneId: id, index: pane.active });
  }
  const next = removeLeaf(store.get(A.layoutAtom), id);
  const root: LayoutNode = next ?? emptyLeaf("p1");
  store.set(A.layoutAtom, root);
  if (store.get(A.activePaneIdAtom) === id) store.set(A.activePaneIdAtom, firstLeafId(root));
}

// 全ペインのタブを写像で更新（rename/move/delete でペイン表示を追従）。
// mapper が null を返したタブは取り除く。
export function remapLeafPaths(store: Store, mapper: (path: string) => string | null) {
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.kind !== "leaf") return { ...n, children: n.children.map(walk) };
    const before = n.tabs[n.active];
    const tabs = n.tabs.map(mapper).filter((p): p is string => !!p);
    const moved = before ? mapper(before) : null;
    const active = moved ? tabs.indexOf(moved) : n.active;
    return leaf(n.id, tabs, active);
  };
  store.set(A.layoutAtom, walk(store.get(A.layoutAtom)));
}

// レイアウトを単一空ペインにリセット（フォルダ切替時など）。
export function resetLayout(store: Store) {
  store.set(A.layoutAtom, emptyLeaf("p1"));
  store.set(A.activePaneIdAtom, "p1");
  // 別のフォルダのパスを開き直しても意味が無い
  store.set(A.closedTabsAtom, []);
}

// 保存されているレイアウト。タブを持たなかった頃の形も読めるようにしてある。
export type StoredNode =
  | {
      kind: "leaf";
      id: string;
      path?: string | null; // 旧形式（1 ペイン 1 ファイル）
      tabs?: string[];
      active?: number;
    }
  | {
      kind: "split";
      id: string;
      dir: "row" | "col";
      sizes: number[];
      children: StoredNode[];
    };

// 保存レイアウトを復元用に再生成する。
// - id を振り直して既存 seq との衝突を防ぐ
// - 存在しないファイルパスは取り除く
// - タブが無かった頃に保存されたものは path を 1 枚のタブとして読む
// 戻り値の active は旧アクティブ leaf に対応する新 id（無ければ先頭 leaf）。
export function reviveLayout(
  node: StoredNode,
  validPaths: Set<string>,
  oldActive: string,
): { layout: LayoutNode; active: string } {
  let newActive = "";
  const walk = (n: StoredNode): LayoutNode => {
    if (n.kind === "leaf") {
      const id = leafId();
      if (n.id === oldActive) newActive = id;
      const stored = n.tabs ?? (n.path ? [n.path] : []);
      const kept = stored.filter((p) => validPaths.has(p));
      const before = stored[n.active ?? 0];
      const at = before ? kept.indexOf(before) : 0;
      return leaf(id, kept, at < 0 ? 0 : at);
    }
    const children = n.children.map(walk);
    return { kind: "split", id: splitId(), dir: n.dir, sizes: n.sizes, children };
  };
  const layout = walk(node);
  return { layout, active: newActive || firstLeafId(layout) };
}

export type { SplitNode };

// フォーカスが編集可能な要素（入力欄・CodeMirror 等）にあるか。
// 本文向けのキー操作を、入力中に横取りさせないための判定。
export function inEditable(target: EventTarget | null): boolean {
  const el = (target as HTMLElement | null) ?? null;
  const ae = document.activeElement as HTMLElement | null;
  const editable = (n: HTMLElement | null) =>
    !!n &&
    (n.tagName === "INPUT" ||
      n.tagName === "TEXTAREA" ||
      n.isContentEditable ||
      // その場編集は shadow root の中にあるので、外からは入れ物しか見えない。
      !!n.closest?.(".cm-editor, .mg-block-cm"));
  return editable(el) || editable(ae);
}

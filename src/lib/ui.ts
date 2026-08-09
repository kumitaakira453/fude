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
  return { ...node, children: node.children.map((c) => splitLeaf(c, targetId, dir, newLeaf, before)) };
}

// leaf を削除。子が1つになった split は畳む。全消しなら空 leaf に。
function removeLeaf(node: LayoutNode, id: string): LayoutNode | null {
  if (node.kind === "leaf") return node.id === id ? null : node;
  const children = node.children.map((c) => removeLeaf(c, id)).filter((c): c is LayoutNode => !!c);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: equal(children.length) };
}

function setPath(node: LayoutNode, id: string, path: string | null): LayoutNode {
  if (node.kind === "leaf") return node.id === id ? { ...node, path } : node;
  return { ...node, children: node.children.map((c) => setPath(c, id, path)) };
}

function setSizes(node: LayoutNode, id: string, sizes: number[]): LayoutNode {
  if (node.kind === "leaf") return node;
  if (node.id === id) return { ...node, sizes };
  return { ...node, children: node.children.map((c) => setSizes(c, id, sizes)) };
}

function firstLeafId(node: LayoutNode): string {
  return node.kind === "leaf" ? node.id : firstLeafId(node.children[0]);
}

// ---- 公開 API ----

// アクティブペインを dir 方向に分割（新ペインは同じファイルを複製表示 or 指定パス）。
export function splitPane(store: Store, dir: "row" | "col", path?: string) {
  const root = store.get(A.layoutAtom);
  if (countLeaves(root) >= A.MAX_PANES) return;
  const activeId = store.get(A.activePaneIdAtom);
  const active = store.get(A.panesAtom).find((p) => p.id === activeId);
  const newLeaf: LeafNode = {
    kind: "leaf",
    id: leafId(),
    path: path !== undefined ? path : (active?.path ?? null),
  };
  store.set(A.layoutAtom, splitLeaf(root, activeId, dir, newLeaf, false));
  store.set(A.activePaneIdAtom, newLeaf.id);
}

// ツールバー用エイリアス
export const splitInto = (store: Store, dir: "row" | "col") => splitPane(store, dir);

// アクティブペインの右に、指定ファイルで新ペインを開く。
export const openToSide = (store: Store, path: string) => splitPane(store, "row", path);

// ドラッグ&ドロップ: 対象ペインのゾーンに応じて開く/分割する。
export function dropOnPane(store: Store, targetId: string, zone: DropZone, path: string) {
  if (zone === "center") {
    store.set(A.layoutAtom, setPath(store.get(A.layoutAtom), targetId, path));
    store.set(A.activePaneIdAtom, targetId);
    return;
  }
  if (countLeaves(store.get(A.layoutAtom)) >= A.MAX_PANES) {
    store.set(A.layoutAtom, setPath(store.get(A.layoutAtom), targetId, path));
    store.set(A.activePaneIdAtom, targetId);
    return;
  }
  const dir: "row" | "col" = zone === "left" || zone === "right" ? "row" : "col";
  const before = zone === "left" || zone === "top";
  const newLeaf: LeafNode = { kind: "leaf", id: leafId(), path };
  store.set(A.layoutAtom, splitLeaf(store.get(A.layoutAtom), targetId, dir, newLeaf, before));
  store.set(A.activePaneIdAtom, newLeaf.id);
}

// split ノードのサイズ更新（リサイザー用）。
export function updateSplitSizes(store: Store, splitNodeId: string, sizes: number[]) {
  store.set(A.layoutAtom, setSizes(store.get(A.layoutAtom), splitNodeId, sizes));
}

// ペインを閉じる。
export function closePane(store: Store, id: string) {
  const next = removeLeaf(store.get(A.layoutAtom), id);
  const root: LayoutNode = next ?? { kind: "leaf", id: "p1", path: null };
  store.set(A.layoutAtom, root);
  if (store.get(A.activePaneIdAtom) === id) store.set(A.activePaneIdAtom, firstLeafId(root));
}

// 指定ペインにファイルを開く（レイアウト内の leaf の path を更新）。
export function setPanePath(store: Store, paneId: string, path: string) {
  store.set(A.layoutAtom, setPath(store.get(A.layoutAtom), paneId, path));
}

// 全 leaf の path を写像で更新（rename/move/delete でペイン表示を追従）。
// mapper が null を返すとそのペインは空になる。
export function remapLeafPaths(store: Store, mapper: (path: string | null) => string | null) {
  const walk = (n: LayoutNode): LayoutNode =>
    n.kind === "leaf"
      ? { ...n, path: mapper(n.path) }
      : { ...n, children: n.children.map(walk) };
  store.set(A.layoutAtom, walk(store.get(A.layoutAtom)));
}

// レイアウトを単一空ペインにリセット（フォルダ切替時など）。
export function resetLayout(store: Store) {
  store.set(A.layoutAtom, { kind: "leaf", id: "p1", path: null });
  store.set(A.activePaneIdAtom, "p1");
}

// 保存レイアウトを復元用に再生成する。
// - id を振り直して既存 seq との衝突を防ぐ
// - 存在しないファイルパスは null に落とす
// 戻り値の active は旧アクティブ leaf に対応する新 id（無ければ先頭 leaf）。
export function reviveLayout(
  node: LayoutNode,
  validPaths: Set<string>,
  oldActive: string,
): { layout: LayoutNode; active: string } {
  let newActive = "";
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.kind === "leaf") {
      const id = leafId();
      if (n.id === oldActive) newActive = id;
      const path = n.path && validPaths.has(n.path) ? n.path : null;
      return { kind: "leaf", id, path };
    }
    const children = n.children.map(walk);
    return { kind: "split", id: splitId(), dir: n.dir, sizes: n.sizes, children };
  };
  const layout = walk(node);
  return { layout, active: newActive || firstLeafId(layout) };
}

export type { SplitNode };

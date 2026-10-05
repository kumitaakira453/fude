import type { getDefaultStore } from "jotai";
import { rootOf, type TreeNode } from "../lib/fsAccess";
import * as A from "./atoms";

// 離れた根の木と本文の控え。ワークスペースを切り替えて戻ってきたとき、
// 走査と読み込みを待たずにその場で描くために使う。メモリにだけ置く。

type Store = ReturnType<typeof getDefaultStore>;

export interface Stash {
  // 根の中身（根を 1 行として吊るす前の木）。
  forest: TreeNode[];
  texts: Map<string, string>;
  // 本文を読んだ時点の更新時刻。戻ったときに今の時刻と比べ、違えば読み直す。
  stamps: Map<string, number>;
  touched: Map<string, number>;
  // 控えたときの決まり。違えば並ぶファイルが変わるので、控えは使えない。
  showOther: boolean;
  ignore: string;
  chars: number;
}

const MAX_ROOTS = 8;
const MAX_CHARS = 150_000_000;

// 最近控えたものほど後ろ（Map は入れた順に並ぶ）。
const stashes = new Map<string, Stash>();

function slice<T>(roots: readonly string[], from: Map<string, T>): Map<string, Map<string, T>> {
  const out = new Map(roots.map((root) => [root, new Map<string, T>()]));
  for (const [path, value] of from) {
    const root = rootOf(roots, path);
    if (root) out.get(root)!.set(path, value);
  }
  return out;
}

function forestOf(tree: TreeNode[], roots: readonly string[], root: string): TreeNode[] {
  if (roots.length === 1) return tree;
  return tree.find((node) => node.path === root)?.children ?? [];
}

function trim() {
  let chars = 0;
  for (const s of stashes.values()) chars += s.chars;
  for (const [root, s] of stashes) {
    if (stashes.size <= MAX_ROOTS && chars <= MAX_CHARS) return;
    stashes.delete(root);
    chars -= s.chars;
  }
}

// 今並べている根それぞれの木・本文・時刻を控える。根を替える前に呼ぶ。
export function stashRoots(store: Store, roots: readonly string[]): void {
  const tree = store.get(A.treeAtom);
  if (roots.length === 0 || tree.length === 0) return;
  const showOther = store.get(A.showOtherFilesAtom);
  const ignores = store.get(A.ignoresByRootAtom);
  const texts = slice(roots, store.get(A.contentCacheAtom));
  const stamps = slice(roots, store.get(A.mtimeCacheAtom));
  const touched = slice(roots, store.get(A.touchedAtom));
  for (const root of roots) {
    const mine = texts.get(root)!;
    let chars = 0;
    for (const text of mine.values()) chars += text.length;
    stashes.delete(root);
    stashes.set(root, {
      forest: forestOf(tree, roots, root),
      texts: mine,
      stamps: stamps.get(root)!,
      touched: touched.get(root)!,
      showOther,
      ignore: ignores.get(root) ?? "",
      chars,
    });
  }
  trim();
}

// 根の控えを取り出す（控えからは外れる）。決まりが今と違えば捨てて null。
export function takeStash(root: string, showOther: boolean, ignore: string): Stash | null {
  const s = stashes.get(root);
  if (!s) return null;
  stashes.delete(root);
  return s.showOther === showOther && s.ignore === ignore ? s : null;
}

export function clearStash(): void {
  stashes.clear();
}

// @vitest-environment jsdom
import { createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { rootNode, type TreeNode } from "../lib/fsAccess";
import * as A from "./atoms";
import { clearStash, stashRoots, takeStash } from "./rootStash";

// 離れた根の控え。根ごとに切り出し、決まりが同じときだけ使い、古いものから捨てる。

const file = (abs: string): TreeNode => ({
  name: abs.slice(abs.lastIndexOf("/") + 1),
  path: abs,
  rel: abs.slice(abs.indexOf("/", 1) + 1),
  abs,
  kind: "file",
});

function seed(roots: string[], texts: Record<string, string>) {
  const store = createStore();
  store.set(A.showOtherFilesAtom, false);
  store.set(A.ignoreAtom, "");
  store.set(A.activeFolderIdAtom, roots[0]);
  store.set(A.extraRootsAtom, roots.slice(1));
  const forests = roots.map((root) =>
    Object.keys(texts)
      .filter((p) => p.startsWith(`${root}/`))
      .map(file),
  );
  store.set(
    A.treeAtom,
    roots.length === 1 ? forests[0] : roots.map((r, i) => rootNode(r, r, forests[i])),
  );
  store.set(A.contentCacheAtom, new Map(Object.entries(texts)));
  store.set(A.mtimeCacheAtom, new Map(Object.keys(texts).map((p) => [p, 1])));
  return store;
}

beforeEach(() => clearStash());

describe("控える", () => {
  it("根ごとに切り出す（ほかの根の本文が混ざらない）", () => {
    const store = seed(["/甲", "/乙"], { "/甲/a.md": "甲", "/乙/a.md": "乙" });
    stashRoots(store, ["/甲", "/乙"]);
    const s = takeStash("/甲", false, "")!;
    expect([...s.texts]).toEqual([["/甲/a.md", "甲"]]);
    expect(s.forest.map((n) => n.path)).toEqual(["/甲/a.md"]);
    expect(s.stamps.get("/甲/a.md")).toBe(1);
  });

  it("取り出したものは控えから外れる", () => {
    const store = seed(["/甲"], { "/甲/a.md": "甲" });
    stashRoots(store, ["/甲"]);
    expect(takeStash("/甲", false, "")).not.toBeNull();
    expect(takeStash("/甲", false, "")).toBeNull();
  });

  it("控えたときと決まりが違えば使わない", () => {
    const store = seed(["/甲", "/乙"], { "/甲/a.md": "甲", "/乙/a.md": "乙" });
    stashRoots(store, ["/甲", "/乙"]);
    expect(takeStash("/甲", true, "")).toBeNull();
    expect(takeStash("/乙", false, "*.tmp")).toBeNull();
  });

  it("根の数が上限を超えたら、古いものから捨てる", () => {
    for (let i = 0; i < 9; i++) {
      const root = `/根${i}`;
      stashRoots(seed([root], { [`${root}/a.md`]: "本文" }), [root]);
    }
    expect(takeStash("/根0", false, "")).toBeNull();
    expect(takeStash("/根1", false, "")).not.toBeNull();
    expect(takeStash("/根8", false, "")).not.toBeNull();
  });
});

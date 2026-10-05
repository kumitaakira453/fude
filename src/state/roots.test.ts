import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import * as A from "./atoms";

// 並べている根と、一覧に出す道筋。

describe("並べている根", () => {
  it("主のフォルダを先頭に、足した根を後ろに並べる（重なりは 1 つに）", () => {
    const store = createStore();
    store.set(A.activeFolderIdAtom, "/a");
    store.set(A.extraRootsAtom, ["/b", "/a"]);
    expect(store.get(A.rootsAtom)).toEqual(["/a", "/b"]);
  });

  it("何も開いていなければ空", () => {
    const store = createStore();
    store.set(A.extraRootsAtom, ["/b"]);
    expect(store.get(A.rootsAtom)).toEqual([]);
  });

  it("根ごとの外すものは、そのフォルダの決まりがあればそれ、無ければ共通", () => {
    const store = createStore();
    store.set(A.activeFolderIdAtom, "/a");
    store.set(A.extraRootsAtom, ["/b"]);
    store.set(A.ignoreAtom, "node_modules/");
    store.set(A.folderIgnoresAtom, { "/b": "" });
    expect([...store.get(A.ignoresByRootAtom)]).toEqual([
      ["/a", "node_modules/"],
      ["/b", ""],
    ]);
  });
});

describe("一覧に出す道筋", () => {
  it("根が 1 つなら根からの相対", () => {
    const store = createStore();
    store.set(A.activeFolderIdAtom, "/a");
    expect(store.get(A.pathLabelAtom)("/a/x/y.md")).toBe("x/y.md");
  });

  it("根が 2 つ以上なら根の名前を頭に付ける（別名があれば別名）", () => {
    const store = createStore();
    store.set(A.activeFolderIdAtom, "/w/a");
    store.set(A.extraRootsAtom, ["/w/b"]);
    store.set(A.foldersAtom, [
      { id: "/w/b", name: "b", path: "/w/b", lastOpened: 0, alias: "資料" },
    ]);
    const label = store.get(A.pathLabelAtom);
    expect(label("/w/a/README.md")).toBe("a/README.md");
    expect(label("/w/b/README.md")).toBe("資料/README.md");
  });

  it("根の外は絶対パスのまま", () => {
    const store = createStore();
    store.set(A.activeFolderIdAtom, "/a");
    expect(store.get(A.pathLabelAtom)("/z/y.md")).toBe("/z/y.md");
  });
});

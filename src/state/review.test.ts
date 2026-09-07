import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import type { ReviewThread } from "../lib/review";
import { EMPTY_LEDGER } from "../lib/review";
import { activeFolderIdAtom } from "./atoms";
import { ledgerAtom, openCountsAtom, openTotalAtom } from "./review";

// 台帳はマシンに 1 つで、他のフォルダの指摘も入っている。入口の数とツリーの
// 数字は、いま開いているフォルダの分だけで揃っていないといけない。

const thread = (id: string, file: string, open = true): ReviewThread => ({
  id,
  file,
  quote: "",
  block_hash: "",
  selection: "",
  selection_offset: 0,
  section_path: [],
  base_version: "",
  status: open ? { kind: "open" } : { kind: "resolved", by: "誰か", at: 0 },
  comments: [],
  created_at: 0,
});

function opened(threads: ReviewThread[], root: string | null) {
  const store = createStore();
  store.set(ledgerAtom, { ...EMPTY_LEDGER, threads });
  store.set(activeFolderIdAtom, root);
  return store;
}

describe("未解決の数え方", () => {
  const threads = [
    thread("a", "/w/one.md"),
    thread("b", "/w/one.md"),
    thread("c", "/w/sub/two.md"),
    thread("d", "/other/three.md"),
    thread("e", "/other/four.md"),
    thread("f", "/w/one.md", false),
  ];

  it("入口の数は開いているフォルダの分だけ", () => {
    const store = opened(threads, "/w");
    expect(store.get(openTotalAtom)).toBe(3);
  });

  it("フォルダを移すと数え直す", () => {
    const store = opened(threads, "/other");
    expect(store.get(openTotalAtom)).toBe(2);
  });

  it("入口の数とファイルごとの数は必ず一致する", () => {
    for (const root of ["/w", "/other", null]) {
      const store = opened(threads, root);
      let sum = 0;
      for (const count of store.get(openCountsAtom).values()) sum += count;
      expect(store.get(openTotalAtom)).toBe(sum);
    }
  });

  it("フォルダを開いていなければ 0", () => {
    expect(opened(threads, null).get(openTotalAtom)).toBe(0);
  });

  it("解決した分は数えない", () => {
    const store = opened([thread("x", "/w/one.md", false)], "/w");
    expect(store.get(openTotalAtom)).toBe(0);
  });

  it("名前が前方一致するだけの別フォルダは数えない", () => {
    const store = opened(
      [thread("g", "/w2/one.md"), thread("h", "/w/one.md")],
      "/w",
    );
    expect(store.get(openTotalAtom)).toBe(1);
  });
});

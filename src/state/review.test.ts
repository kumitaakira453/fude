import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewThread } from "../lib/review";
import { EMPTY_LEDGER } from "../lib/review";
import { activeFolderIdAtom } from "./atoms";
import { forgetLedger, ledgerAtom, openCountsAtom, openTotalAtom, refreshLedger } from "./review";

// 台帳はマシンに 1 つで、他のフォルダの指摘も入っている。入口の数とツリーの
// 数字は、いま開いているフォルダの分だけで揃っていないといけない。

// 台帳の読み込みは Tauri 側の口を叩くので、試験では字を差し替える。
let onDisk = "";
vi.mock("../lib/review", async (real) => {
  const mod = await real<typeof import("../lib/review")>();
  return {
    ...mod,
    readLedger: async () => ({
      ledger: onDisk ? (JSON.parse(onDisk) as never) : mod.EMPTY_LEDGER,
      text: onDisk,
    }),
  };
});

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

// 読み直しの合図は重なる（自分の書き込みと、ファイルの見張りと、窓の数だけ）。
// 中身が同じなら台帳を差し替えない——差し替えると、見ている画面が一斉に
// 描き直される。
describe("台帳の読み直し", () => {
  afterEach(() => {
    forgetLedger();
    onDisk = "";
  });

  const ledgerOf = (ids: string[]) =>
    JSON.stringify({
      format_version: 1,
      threads: ids.map((id) => thread(id, "/a.md")),
      versions: [],
    });

  it("中身が変わったときだけ差し替える", async () => {
    const store = createStore();
    let swaps = 0;
    store.sub(ledgerAtom, () => swaps++);

    onDisk = ledgerOf(["t1"]);
    await refreshLedger(store);
    expect(swaps).toBe(1);
    expect(store.get(ledgerAtom).threads).toHaveLength(1);

    // 同じ字が 2 回届いても差し替えない
    await refreshLedger(store);
    await refreshLedger(store);
    expect(swaps).toBe(1);

    // 外から書き換わったら差し替える
    onDisk = ledgerOf(["t1", "t2"]);
    await refreshLedger(store);
    expect(swaps).toBe(2);
    expect(store.get(ledgerAtom).threads).toHaveLength(2);
  });
});

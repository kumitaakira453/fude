import { describe, expect, it, vi } from "vitest";

// ファイル一覧の組み立て。走査と「何を外すか」の判定は Rust 側にあるので、
// ここで見るのは返ってきた平らな並びを木へ組むところと、走査へ渡す引数。

// 走査が返す並び。親は子より先に来る。
const SCAN = [
  { path: "はじめ.md", dir: false },
  { path: "章2.md", dir: false },
  { path: "章10.md", dir: false },
  { path: "中", dir: true },
  { path: "中/奥.md", dir: false },
  { path: "中/図.svg", dir: false },
  { path: "空", dir: true },
];

const asked: { only: string[]; skip: string[]; ignore: string; depth: number }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (
    _command: string,
    args: { only: string[]; skip: string[]; ignore: string; depth: number },
  ) => {
    asked.push(args);
    // 深さ 1 はその階層だけ（Rust 側がそこで止める）。
    return Promise.resolve(
      args.depth === 1 ? SCAN.filter((e) => !e.path.includes("/")) : SCAN,
    );
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const { buildTree, readLevel, MARKDOWN_SIEVE } = await import("./fsAccess");
const { VIEWABLE_SIEVE } = await import("./kind");

const names = (nodes: { name: string }[]) => nodes.map((n) => n.name);
const last = () => asked.at(-1)!;

describe("木を作る", () => {
  it("フォルダが先、名前は数の大きさの順に並ぶ", async () => {
    const tree = await buildTree("/docs");
    expect(names(tree)).toEqual(["空", "中", "はじめ.md", "章2.md", "章10.md"]);
  });

  it("下の階層も組む", async () => {
    const tree = await buildTree("/docs");
    const inner = tree.find((n) => n.name === "中");
    expect(names(inner?.children ?? [])).toEqual(["奥.md", "図.svg"]);
  });

  it("中身の無いフォルダも並べる", async () => {
    const tree = await buildTree("/docs");
    const empty = tree.find((n) => n.name === "空");
    expect(empty?.kind).toBe("dir");
    expect(empty?.children).toEqual([]);
  });

  it("絶対パスは根からの道筋で組む", async () => {
    const tree = await buildTree("/docs");
    const inner = tree.find((n) => n.name === "中");
    expect(inner?.children?.[0]?.abs).toBe("/docs/中/奥.md");
  });
});

describe("走査へ渡すもの", () => {
  it("ふるいは拡張子の並びだけ", async () => {
    await buildTree("/docs", MARKDOWN_SIEVE);
    expect(last().only).toEqual(["md", "markdown", "mdx", "mdown", "mkd"]);
    expect(last().skip).toEqual([]);

    await buildTree("/docs", VIEWABLE_SIEVE);
    expect(last().only).toEqual([]);
    expect(last().skip).toContain("zip");
  });

  it("一覧から外すものは設定の本文をそのまま渡す", async () => {
    await buildTree("/docs", MARKDOWN_SIEVE, "node_modules/\n!残す.md");
    expect(last().ignore).toBe("node_modules/\n!残す.md");
  });

  it("木は限りなく、1 階層だけ読むときは深さ 1", async () => {
    await buildTree("/docs");
    expect(last().depth).toBe(0);

    await readLevel("/docs/中");
    expect(last().depth).toBe(1);
  });
});

describe("1 階層だけ読む", () => {
  it("道筋は絶対パスで返す", async () => {
    const level = await readLevel("/docs");
    expect(names(level)).toEqual(["空", "中", "はじめ.md", "章2.md", "章10.md"]);
    expect(level[0].path).toBe("/docs/空");
    expect(level[0].abs).toBe("/docs/空");
  });
});

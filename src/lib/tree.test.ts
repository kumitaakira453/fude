import { describe, expect, it, vi } from "vitest";

// ファイル一覧に何を並べるか。走査そのものは Rust 側で行い、ここでは返ってきた
// 平らな並びを木へ組むところと、設定で書いた除外の当たり方を見る。

const ENTRIES: Record<string, { name: string; isFile: boolean; isDirectory: boolean }[]> = {
  "/docs": [
    { name: "はじめ.md", isFile: true, isDirectory: false },
    { name: "絵.png", isFile: true, isDirectory: false },
    { name: "頁.html", isFile: true, isDirectory: false },
    { name: "資料.pdf", isFile: true, isDirectory: false },
    { name: "控え.txt", isFile: true, isDirectory: false },
    { name: "書庫.zip", isFile: true, isDirectory: false },
    { name: "中", isFile: false, isDirectory: true },
    { name: "node_modules", isFile: false, isDirectory: true },
    { name: ".git", isFile: false, isDirectory: true },
  ],
  "/docs/中": [
    { name: "奥.md", isFile: true, isDirectory: false },
    { name: "図.svg", isFile: true, isDirectory: false },
  ],
};

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: (dir: string) => Promise.resolve(ENTRIES[dir] ?? []),
  exists: () => Promise.resolve(true),
  mkdir: () => Promise.resolve(),
  readFile: () => Promise.resolve(new Uint8Array()),
  readTextFile: () => Promise.resolve(""),
  remove: () => Promise.resolve(),
  rename: () => Promise.resolve(),
  stat: () => Promise.resolve({ mtime: new Date(0) }),
  writeTextFile: () => Promise.resolve(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

// 走査が返す並び。親は子より先に来る。拡張子のふるいは Rust 側で当たるので、
// ここでは通ったものがそのまま返ってくるものとして組む。
const SCAN = [
  { path: "はじめ.md", dir: false },
  { path: "絵.png", dir: false },
  { path: "頁.html", dir: false },
  { path: "資料.pdf", dir: false },
  { path: "控え.txt", dir: false },
  { path: "章2.md", dir: false },
  { path: "章10.md", dir: false },
  { path: "中", dir: true },
  { path: "中/奥.md", dir: false },
  { path: "中/図.svg", dir: false },
  { path: "空", dir: true },
];

const asked: { only: string[]; skip: string[] }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (_command: string, args: { only: string[]; skip: string[] }) => {
    asked.push({ only: args.only, skip: args.skip });
    return Promise.resolve(SCAN);
  },
}));

const { buildTree, isMarkdown, readLevel, MARKDOWN_SIEVE } = await import("./fsAccess");
const { isViewable, VIEWABLE_SIEVE } = await import("./kind");
const { withExcluded } = await import("./exclude");

const names = (nodes: { name: string }[]) => nodes.map((n) => n.name);

describe("1 階層だけ読む", () => {
  it("既定は Markdown とフォルダだけ", async () => {
    expect(names(await readLevel("/docs"))).toEqual(["中", "はじめ.md"]);
  });

  it("開けるものを渡せば画像・HTML・PDF・字のファイルも並ぶ", async () => {
    expect(names(await readLevel("/docs", isViewable))).toEqual([
      "中",
      "はじめ.md",
      "絵.png",
      "控え.txt",
      "資料.pdf",
      "頁.html",
    ]);
  });

  it("字にならないものは、どちらでも出さない", async () => {
    expect(names(await readLevel("/docs", isViewable))).not.toContain("書庫.zip");
    expect(names(await readLevel("/docs"))).not.toContain("控え.txt");
  });
});

describe("木を作る", () => {
  it("絞り込みは下の階層にも効く", async () => {
    const tree = await buildTree("/docs", isViewable, VIEWABLE_SIEVE);
    const inner = tree.find((n) => n.name === "中");
    expect(names(inner?.children ?? [])).toEqual(["奥.md", "図.svg"]);
  });

  it("Markdown だけなら下の階層も Markdown だけ", async () => {
    const tree = await buildTree("/docs", isMarkdown, MARKDOWN_SIEVE);
    const inner = tree.find((n) => n.name === "中");
    expect(names(inner?.children ?? [])).toEqual(["奥.md"]);
  });

  it("フォルダが先、名前は数の大きさの順に並ぶ", async () => {
    const tree = await buildTree("/docs", isMarkdown, MARKDOWN_SIEVE);
    expect(names(tree)).toEqual(["空", "中", "はじめ.md", "章2.md", "章10.md"]);
  });

  it("中身の無いフォルダも並べる", async () => {
    const tree = await buildTree("/docs", isMarkdown, MARKDOWN_SIEVE);
    const empty = tree.find((n) => n.name === "空");
    expect(empty?.kind).toBe("dir");
    expect(empty?.children).toEqual([]);
  });

  it("絶対パスは根からの道筋で組む", async () => {
    const tree = await buildTree("/docs", isMarkdown, MARKDOWN_SIEVE);
    const inner = tree.find((n) => n.name === "中");
    expect(inner?.children?.[0]?.abs).toBe("/docs/中/奥.md");
  });

  it("設定で書いた除外が当たる", async () => {
    const tree = await buildTree(
      "/docs",
      withExcluded(isMarkdown, "章*.md"),
      MARKDOWN_SIEVE,
    );
    expect(names(tree)).toEqual(["空", "中", "はじめ.md"]);
  });

  it("走査へ渡すふるいは拡張子の並びだけ", async () => {
    asked.length = 0;
    await buildTree("/docs", isMarkdown, MARKDOWN_SIEVE);
    expect(asked.at(-1)).toEqual({
      only: ["md", "markdown", "mdx", "mdown", "mkd"],
      skip: [],
    });
    await buildTree("/docs", isViewable, VIEWABLE_SIEVE);
    expect(asked.at(-1)?.only).toEqual([]);
    expect(asked.at(-1)?.skip).toContain("zip");
  });
});

import { describe, expect, it, vi } from "vitest";

// ファイル一覧に何を並べるか。Markdown だけの見え方と、画像・HTML・PDF も
// 並ぶ見え方を切り替えられる。

const ENTRIES: Record<string, { name: string; isFile: boolean; isDirectory: boolean }[]> = {
  "/docs": [
    { name: "はじめ.md", isFile: true, isDirectory: false },
    { name: "絵.png", isFile: true, isDirectory: false },
    { name: "頁.html", isFile: true, isDirectory: false },
    { name: "資料.pdf", isFile: true, isDirectory: false },
    { name: "控え.txt", isFile: true, isDirectory: false },
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

const { buildTree, isMarkdown, readLevel } = await import("./fsAccess");
const { isViewable } = await import("./kind");

const names = (nodes: { name: string }[]) => nodes.map((n) => n.name);

describe("1 階層だけ読む", () => {
  it("既定は Markdown とフォルダだけ", async () => {
    expect(names(await readLevel("/docs"))).toEqual(["中", "はじめ.md"]);
  });

  it("開けるものを渡せば画像・HTML・PDF も並ぶ", async () => {
    expect(names(await readLevel("/docs", isViewable))).toEqual([
      "中",
      "はじめ.md",
      "絵.png",
      "資料.pdf",
      "頁.html",
    ]);
  });

  it("開けないものは、どちらでも出さない", async () => {
    expect(names(await readLevel("/docs", isViewable))).not.toContain("控え.txt");
  });
});

describe("木を作る", () => {
  it("絞り込みは下の階層にも効く", async () => {
    const tree = await buildTree("/docs", isViewable);
    const inner = tree.find((n) => n.name === "中");
    expect(names(inner?.children ?? [])).toEqual(["奥.md", "図.svg"]);
  });

  it("Markdown だけなら下の階層も Markdown だけ", async () => {
    const tree = await buildTree("/docs", isMarkdown);
    const inner = tree.find((n) => n.name === "中");
    expect(names(inner?.children ?? [])).toEqual(["奥.md"]);
  });

  it("走査から外すフォルダは並べない", async () => {
    const tree = await buildTree("/docs", isViewable);
    expect(names(tree)).not.toContain("node_modules");
    expect(names(tree)).not.toContain(".git");
  });
});

import { describe, expect, it } from "vitest";
import { folderDisplayName, rankDocs, type DocEntry } from "./idb";

const doc = (path: string, lastOpened: number): DocEntry => ({
  id: path,
  name: path.split("/").pop() ?? path,
  path,
  lastOpened,
});

describe("1 枚で開いたファイルの履歴", () => {
  it("新しい順に並ぶ", () => {
    const list = [doc("/a.md", 300), doc("/b.md", 100)];
    expect(rankDocs(list, doc("/c.md", 200)).map((d) => d.path)).toEqual([
      "/a.md",
      "/c.md",
      "/b.md",
    ]);
  });

  it("同じ道筋は 1 つに畳み、新しい時刻で先頭へ来る", () => {
    const list = [doc("/a.md", 300), doc("/b.md", 100)];
    const next = rankDocs(list, doc("/b.md", 500));
    expect(next.map((d) => d.path)).toEqual(["/b.md", "/a.md"]);
    expect(next[0].lastOpened).toBe(500);
  });

  it("名前が変わっていたら新しいほうで上書きする", () => {
    const was = { ...doc("/a.md", 100), name: "古い名前" };
    expect(rankDocs([was], doc("/a.md", 200))[0].name).toBe("a.md");
  });

  it("上限を超えたら古いものから落ちる", () => {
    const list = Array.from({ length: 20 }, (_, i) => doc(`/${i}.md`, i));
    const next = rankDocs(list, doc("/新.md", 999));
    expect(next.length).toBe(20);
    expect(next[0].path).toBe("/新.md");
    expect(next.map((d) => d.path)).not.toContain("/0.md");
  });

  it("エイリアスがあれば表示名に使う（フォルダと同じ扱い）", () => {
    expect(folderDisplayName({ ...doc("/a.md", 1), alias: "あだ名" })).toBe("あだ名");
    expect(folderDisplayName(doc("/a.md", 1))).toBe("a.md");
  });
});

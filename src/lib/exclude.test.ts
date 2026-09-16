import { describe, expect, it } from "vitest";
import { excludeRules, isExcluded, withExcluded } from "./exclude";

const drops = (text: string, name: string) => isExcluded(name, excludeRules(text));

describe("一覧から外す名前", () => {
  it("拡張子だけ書けば、その拡張子に当たる", () => {
    expect(drops("log", "動き.log")).toBe(true);
    expect(drops(".log", "動き.log")).toBe(true);
    expect(drops("log", "blog.md")).toBe(false);
    expect(drops("log", "log.md")).toBe(false);
  });

  it("同じ名前のファイルにも当たる", () => {
    expect(drops("log", "log")).toBe(true);
    expect(drops("Makefile", "Makefile")).toBe(true);
    expect(drops(".DS_Store", ".DS_Store")).toBe(true);
  });

  it("途中に点のある書き方は、名前そのものとして当たる", () => {
    expect(drops("package-lock.json", "package-lock.json")).toBe(true);
    expect(drops("package-lock.json", "lock.json")).toBe(false);
  });

  it("* は任意の並び、? は 1 文字", () => {
    expect(drops("*.min.js", "app.min.js")).toBe(true);
    expect(drops("*.min.js", "app.js")).toBe(false);
    expect(drops("控え?.md", "控え1.md")).toBe(true);
    expect(drops("控え?.md", "控え12.md")).toBe(false);
  });

  it("大文字小文字は区別しない", () => {
    expect(drops("log", "動き.LOG")).toBe(true);
    expect(drops("*.PNG", "絵.png")).toBe(true);
  });

  it("空の行と # の行は読み飛ばす", () => {
    expect(excludeRules("\n\n  \n# これは覚書\nlog\n")).toHaveLength(1);
    expect(drops("# log", "動き.log")).toBe(false);
  });

  it("式として意味を持つ字も、字そのものとして当たる", () => {
    expect(drops("a+b.md", "a+b.md")).toBe(true);
    expect(drops("a+b.md", "aab.md")).toBe(false);
    expect(drops("[控え].md", "[控え].md")).toBe(true);
    // 壊れた式にならない（例外を投げない）。
    expect(() => excludeRules("(")).not.toThrow();
    expect(drops("(", "(")).toBe(true);
  });

  it("複数行はどれか 1 つ当たれば外す", () => {
    const text = "*.lock\nlog\n";
    expect(drops(text, "yarn.lock")).toBe(true);
    expect(drops(text, "動き.log")).toBe(true);
    expect(drops(text, "メモ.md")).toBe(false);
  });
});

describe("出す判断へ重ねる", () => {
  const md = (name: string) => name.endsWith(".md");

  it("外す分だけを落とす", () => {
    const show = withExcluded(md, "控え");
    expect(show("メモ.md")).toBe(true);
    expect(show("メモ.控え")).toBe(false);
  });

  it("元が出さないものを出すようにはしない", () => {
    const show = withExcluded(md, "log");
    expect(show("動き.txt")).toBe(false);
  });

  it("何も書いていなければ、元の判断のまま", () => {
    expect(withExcluded(md, "")).toBe(md);
    expect(withExcluded(md, "\n#  覚書\n")).toBe(md);
  });
});

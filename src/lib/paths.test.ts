import { describe, expect, it } from "vitest";
import { dirOf, resolvePath } from "./paths";

// 書かれた道筋を、フォルダの根からの相対に直すところ。

describe("resolvePath", () => {
  it("同じ場所のファイル", () => {
    expect(resolvePath("docs", "./b.md")).toBe("docs/b.md");
  });

  it("上の階層へ戻る", () => {
    expect(resolvePath("docs/inner", "../b.md")).toBe("docs/b.md");
  });

  it("根より上へは出ない", () => {
    expect(resolvePath("docs", "../../../b.md")).toBe("b.md");
  });

  it("頭が / なら、今いる場所ではなく根から解く", () => {
    // 塗のリンクを写すときの形。どのファイルに貼っても同じ場所を指す。
    expect(resolvePath("docs/inner", "/レビュー見本/会話の見本.md")).toBe(
      "レビュー見本/会話の見本.md",
    );
  });

  it("断片と問い合わせは道筋に含めない", () => {
    expect(resolvePath("docs", "./b.md#見出し")).toBe("docs/b.md");
    expect(resolvePath("docs", "./b.md?v=1")).toBe("docs/b.md");
  });

  it("根そのものからの呼び出し", () => {
    expect(resolvePath("", "a/b.md")).toBe("a/b.md");
  });
});

describe("dirOf", () => {
  it("最後の区切りまでを返す", () => {
    expect(dirOf("a/b/c.md")).toBe("a/b");
  });

  it("区切りが無ければ空", () => {
    expect(dirOf("c.md")).toBe("");
  });
});

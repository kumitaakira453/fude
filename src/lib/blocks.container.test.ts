import { describe, expect, it } from "vitest";
import { splitBlocks } from "./blocks";

// 囲み（callout / details）は開きから閉じまでで 1 ブロック。
//
// CommonMark に任せると、中に空行があれば開き・中身・閉じに割れ、空行が無ければ
// 後ろの本文まで同じ塊に飲み込む。読む面はブロックごとに描くので、割れると
// トグルが中身を抱えられない（空のトグルの下に本文が並ぶ）。

const lines = (...rows: string[]) => rows.join("\n");

const kinds = (src: string) => splitBlocks(src).map((b) => b.type);
const srcs = (src: string) => splitBlocks(src).map((b) => b.src);

describe("囲みの切り出し", () => {
  it("中に空行のあるトグルが 1 ブロックになる", () => {
    const src = lines("<details>", "<summary>ひらく</summary>", "", "中の本文", "", "</details>", "");
    expect(srcs(src)).toEqual([
      lines("<details>", "<summary>ひらく</summary>", "", "中の本文", "", "</details>"),
    ]);
  });

  it("閉じの後ろの本文が飲み込まれない", () => {
    const src = lines(
      "<details>",
      "<summary>Figma</summary>",
      "<!-- x -->",
      "</details>",
      "- 変更点",
      "\t- こまかい話",
      "",
    );
    expect(kinds(src)).toEqual(["html", "list"]);
  });

  it("入れ子のトグルも外側ごと 1 ブロック", () => {
    const src = lines(
      "<details>",
      "<summary>外</summary>",
      "",
      "<details>",
      "<summary>中</summary>",
      "",
      "中の本文",
      "",
      "</details>",
      "",
      "外の本文",
      "",
      "</details>",
      "",
    );
    expect(kinds(src)).toEqual(["html"]);
  });

  it("段落が 2 つある callout も 1 ブロック", () => {
    const src = lines('<callout icon="💡">', "一つめ", "", "二つめ", "</callout>", "");
    expect(kinds(src)).toEqual(["html"]);
  });

  it("閉じが無ければ今までどおり割れたまま", () => {
    const src = lines("<details>", "<summary>ひらく</summary>", "", "中の本文", "");
    expect(kinds(src)).toEqual(["html", "paragraph"]);
  });

  it("項目の中の囲みは一覧ごと 1 ブロックのまま", () => {
    const src = lines("- 項目", "", '  <callout icon="💡">', "  中の文", "  </callout>", "");
    expect(kinds(src)).toEqual(["list"]);
  });
});

describe("親の項目を失った一覧", () => {
  it("字下げコードではなく一覧として切る", () => {
    const src = lines("| a | b |", "| --- | --- |", "| 1 | 2 |", "\t\t- 続きの項目", "\t\t\t- その子");
    expect(kinds(src)).toEqual(["table", "list"]);
  });

  it("ブロックの範囲は行の頭から（原文の字下げごと持つ）", () => {
    const src = lines("| a | b |", "| --- | --- |", "| 1 | 2 |", "\t\t- 続きの項目");
    const [, list] = splitBlocks(src);
    expect(list.src).toBe("\t\t- 続きの項目");
    expect(src.slice(list.start, list.end)).toBe(list.src);
  });

  it("中に囲みがあれば、そこで切り分ける", () => {
    const src = lines(
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "\t\t- 続きの項目",
      "\t\t<details>",
      "\t\t<summary>ひらく</summary>",
      "\t\t- 中の項目",
      "\t\t</details>",
      "\t\t- あとの項目",
    );
    expect(kinds(src)).toEqual(["table", "list", "html", "list"]);
  });

  it("空白字下げの本物のコードは触らない", () => {
    const src = lines("段落", "", "    objects: Permission[] = [", "      1,", "    ];");
    expect(kinds(src)).toEqual(["paragraph", "code"]);
  });
});

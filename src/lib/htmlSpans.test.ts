import { describe, expect, it } from "vitest";
import {
  commonIndent,
  containerSpans,
  innerPad,
  lostList,
  unpadLines,
} from "./htmlSpans";

// 囲みの範囲は行で決める。CommonMark に任せると、空行の有無で飲み込んだり
// 割れたりする。

const lines = (...rows: string[]) => rows.join("\n");

describe("containerSpans", () => {
  it("開きから閉じまでを 1 つの範囲にする", () => {
    const src = lines("<callout>", "中の文", "</callout>", "");
    const [span] = containerSpans(src);
    expect(span.kind).toBe("callout");
    expect(src.slice(span.start, span.end)).toBe(
      lines("<callout>", "中の文", "</callout>"),
    );
  });

  it("入れ子は深さを数えて対にする", () => {
    const src = lines(
      "<details>",
      "<summary>外</summary>",
      "<details>",
      "<summary>中</summary>",
      "</details>",
      "</details>",
      "あとの段落",
    );
    const spans = containerSpans(src);
    expect(spans).toHaveLength(1);
    expect(src.slice(spans[0].start, spans[0].end).split("\n")).toHaveLength(6);
  });

  it("閉じが無ければ範囲にしない", () => {
    expect(containerSpans(lines("<callout>", "閉じ忘れ"))).toEqual([]);
  });

  it("字下げのある開きは範囲にしない（項目ごと 1 ブロックにしたい）", () => {
    const src = lines("- 項目", "  <callout>", "  中の文", "  </callout>");
    expect(containerSpans(src)).toEqual([]);
  });

  it("並んだ囲みはそれぞれ範囲になる", () => {
    const src = lines(
      "<callout>",
      "一つめ",
      "</callout>",
      "",
      "<callout>",
      "二つめ",
      "</callout>",
    );
    expect(containerSpans(src)).toHaveLength(2);
  });
});

describe("unpadLines", () => {
  it("落とした後の位置から元の位置を引ける", () => {
    const cut = unpadLines(lines("\t- 一つめ", "\t\t- その子"), "\t")!;
    expect(cut.text).toBe(lines("- 一つめ", "\t- その子"));
    // 落とした後の頭は、原文ではタブの次
    expect(cut.back(0)).toBe(1);
    // 2 行目の頭も同じだけずれる
    const at = cut.text.indexOf("\t- その子");
    expect(cut.back(at)).toBe(lines("\t- 一つめ", "\t\t- その子").indexOf("\t\t- その子") + 1);
  });

  it("字下げの足りない行は空白のあるところまでしか落とさない", () => {
    const cut = unpadLines(lines("    字下げあり", "字下げなし"), "    ")!;
    expect(cut.text).toBe(lines("字下げあり", "字下げなし"));
  });

  it("落とすものが無ければ null", () => {
    expect(unpadLines("字下げなし", "")).toBeNull();
  });
});

describe("innerPad", () => {
  it("囲みが立っている桁の分は落とす", () => {
    expect(innerPad(["  中の文"], "  ")).toBe("  ");
  });

  it("その先がタブなら入れ子の写しとして落とす", () => {
    expect(innerPad(["\t- 項目", "\t\t- その子"], "")).toBe("\t");
  });

  it("空白の字下げも落とす（囲みの中身は桁を下げて書き出される）", () => {
    expect(innerPad(["    中の文"], "")).toBe("    ");
    expect(innerPad(["     中の文"], "")).toBe("     ");
  });

  it("囲みが立っている桁より浅ければ、その桁までにとどめる", () => {
    expect(innerPad(["中の文"], "  ")).toBe("  ");
  });
});

describe("lostList", () => {
  it("字下げされた箇条書きは、親を失った一覧として読む", () => {
    expect(lostList(lines("    - 単体作成", "    - 一括作成"))).toBe(true);
  });

  it("タブ字下げなら、間に画像やタグが挟まっても一覧として読む", () => {
    expect(lostList(lines("\t\t- 項目", "\t\t<!-- nb:image -->", "\t\t- つぎ"))).toBe(true);
  });

  it("空白字下げで箇条書きの印が無ければ触らない", () => {
    expect(lostList(lines("    objects: Permission[] = [", "      1,", "    ];"))).toBe(false);
  });

  it("字下げの無いものは触らない", () => {
    expect(lostList("- 項目")).toBe(false);
  });
});

describe("commonIndent", () => {
  it("空でない行に共通の行頭空白を返す", () => {
    expect(commonIndent(["\t\t- a", "", "\t\t\t- b"])).toBe("\t\t");
  });
});

describe("囲みのコードの中は囲みとして読まない", () => {
  // 記法の見本として `<callout>` を囲みのコードに入れて書くと、ここで本文が
  // 切られてしまい、閉じの ``` から後ろがすべてコードとして描かれていた。
  const sample = [
    "## callout",
    "",
    "新記法を使う。",
    "",
    "```markdown",
    '<callout icon="💡" color="gray_bg">',
    "本文。",
    "</callout>",
    "```",
    "",
    "タグの中も **1 行 = 1 段落**。",
  ].join("\n");

  it("見本の callout は囲みにならない", () => {
    expect(containerSpans(sample)).toEqual([]);
  });

  it("囲みの外にある callout は今までどおり拾う", () => {
    const src = `${sample}\n\n<callout icon="⚠️">\n本物。\n</callout>\n`;
    const spans = containerSpans(src);
    expect(spans).toHaveLength(1);
    expect(src.slice(spans[0].start, spans[0].end)).toBe(
      '<callout icon="⚠️">\n本物。\n</callout>',
    );
  });

  it("~~~ の囲みも同じ", () => {
    const src = ["~~~", "<callout>", "見本。", "</callout>", "~~~"].join("\n");
    expect(containerSpans(src)).toEqual([]);
  });

  it("囲みの中に書いたコードで、閉じを見失わない", () => {
    const src = [
      "<callout>",
      "説明。",
      "",
      "```md",
      "</callout>",
      "```",
      "",
      "続き。",
      "</callout>",
      "あと。",
    ].join("\n");
    const spans = containerSpans(src);
    expect(spans).toHaveLength(1);
    expect(src.slice(spans[0].start, spans[0].end).endsWith("続き。\n</callout>")).toBe(
      true,
    );
  });
});

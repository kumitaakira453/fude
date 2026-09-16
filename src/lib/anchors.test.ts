import { describe, expect, it } from "vitest";
import { anchorAt, headingIds, splitHref } from "./anchors";
import { splitBlocks } from "./blocks";

// ページ内リンクの行き先。見出しの id は描くときに rehype-slug が振るので、
// ここで出すものが画面と食い違わないことを見る。

describe("splitHref", () => {
  it("断片だけのリンクは、道筋を持たない", () => {
    expect(splitHref("#やり取り")).toEqual({ path: "", id: "やり取り" });
  });

  it("道筋だけのリンクは、断片を持たない", () => {
    expect(splitHref("./05_要件定義書.md")).toEqual({
      path: "./05_要件定義書.md",
      id: "",
    });
  });

  it("道筋と断片を分ける", () => {
    expect(splitHref("./05_要件定義書.md#ログ管理")).toEqual({
      path: "./05_要件定義書.md",
      id: "ログ管理",
    });
  });

  it("符号化された断片を解く（GitHub から写したリンク）", () => {
    expect(splitHref("./a.md#%E7%89%88").id).toBe("版");
  });

  it("解けない符号はそのまま使う", () => {
    // 途中で切れた符号。解こうとすると例外になる。
    expect(splitHref("#%E4%B8").id).toBe("%E4%B8");
  });

  it("断片の中の # は、最初の # だけで割る", () => {
    expect(splitHref("./a.md#見出し#2")).toEqual({
      path: "./a.md",
      id: "見出し#2",
    });
  });
});

describe("headingIds", () => {
  it("見出しの字から id を出す", () => {
    const blocks = splitBlocks("# 題\n\n本文。\n\n## やり取り\n\nつづき。\n");
    expect([...headingIds(blocks).values()]).toEqual(["題", "やり取り"]);
  });

  it("同じ見出しが並ぶときは、描くときと同じ連番を振る", () => {
    const blocks = splitBlocks("## 版\n\nあ\n\n## 版\n\nい\n\n## 版\n");
    expect([...headingIds(blocks).values()]).toEqual(["版", "版-1", "版-2"]);
  });

  it("記法は落として、画面に出る字から作る", () => {
    // `Code` の囲みは描くと消える。GitHub と同じ規則で小文字・括弧落ちになる。
    const blocks = splitBlocks("## `Code` テーブル（変更）\n");
    expect([...headingIds(blocks).values()]).toEqual(["code-テーブル変更"]);
  });

  it("見出しが無ければ空", () => {
    expect(headingIds(splitBlocks("本文だけ。\n")).size).toBe(0);
  });
});

describe("anchorAt", () => {
  const blocks = splitBlocks("# 題\n\n前書き。\n\n## やり取り\n\n本文。\n\n### 中\n\n奥。\n");

  it("その塊を含む節を返す", () => {
    expect(anchorAt(blocks, 3)).toBe("やり取り");
  });

  it("いちばん近い見出しを採る（深い節が勝つ）", () => {
    expect(anchorAt(blocks, 5)).toBe("中");
  });

  it("見出しそのものは、自分の id を返す", () => {
    expect(anchorAt(blocks, 2)).toBe("やり取り");
  });

  it("手前に見出しが無ければ null", () => {
    expect(anchorAt(splitBlocks("本文だけ。\n"), 0)).toBeNull();
  });
});

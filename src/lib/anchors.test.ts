import { describe, expect, it } from "vitest";
import { anchorAt, headingIds, slugsOf, splitHref } from "./anchors";
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

  it("その塊を含む節を、id と字で返す", () => {
    // 字はリンクの題になる。行き先だけ渡しても、貼った先で何を指しているのか
    // 読めない。
    expect(anchorAt(blocks, 3)).toEqual({ id: "やり取り", text: "やり取り" });
  });

  it("いちばん近い見出しを採る（深い節が勝つ）", () => {
    expect(anchorAt(blocks, 5)?.id).toBe("中");
  });

  it("見出しそのものは、自分の節を返す", () => {
    expect(anchorAt(blocks, 2)?.id).toBe("やり取り");
  });

  it("記法は落として、画面に出る字を題にする", () => {
    const withCode = splitBlocks("## `Code` の話\n\n本文。\n");
    expect(anchorAt(withCode, 1)).toEqual({ id: "code-の話", text: "Code の話" });
  });

  it("手前に見出しが無ければ null", () => {
    expect(anchorAt(splitBlocks("本文だけ。\n"), 0)).toBeNull();
  });
});

describe("slugsOf", () => {
  it("並びの順で id を作る", () => {
    expect(slugsOf(["やり取り", "版"])).toEqual(["やり取り", "版"]);
  });

  it("同じ字が 2 度目に出たら連番を振る（描くときと同じ）", () => {
    expect(slugsOf(["版", "他", "版", "版"])).toEqual(["版", "他", "版-1", "版-2"]);
  });

  it("前後の空白は落とす", () => {
    expect(slugsOf(["  やり取り  "])).toEqual(["やり取り"]);
  });
});

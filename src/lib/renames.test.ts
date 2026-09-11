import { describe, expect, it } from "vitest";
import { pairRenames } from "./renames";

// 監視は「消えた」「現れた」としか教えてくれない。開いているタブを付け替える
// ために組にするが、当てずっぽうで組むと無関係な削除と作成が入れ替わって見える。

describe("pairRenames", () => {
  it("1 対 1 なら名前が変わったと見る", () => {
    expect(pairRenames(["a.md"], ["b.md"])).toEqual([["a.md", "b.md"]]);
  });

  it("同じファイル名なら、置き場所が変わっただけとして組む", () => {
    expect(pairRenames(["a.md", "x.md"], ["y.md", "sub/a.md"])).toEqual([
      ["a.md", "sub/a.md"],
      ["x.md", "y.md"],
    ]);
  });

  it("どちらかが空なら組まない", () => {
    expect(pairRenames(["a.md"], [])).toEqual([]);
    expect(pairRenames([], ["b.md"])).toEqual([]);
  });

  it("多対多で手がかりが無ければ組まない", () => {
    expect(pairRenames(["a.md", "b.md"], ["c.md", "d.md"])).toEqual([]);
  });

  it("同じ名前が 2 つ現れたら、その組は作らない", () => {
    expect(pairRenames(["a.md"], ["one/a.md", "two/a.md"])).toEqual([]);
  });
});

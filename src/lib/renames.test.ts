import { describe, expect, it } from "vitest";
import { matchRenames, newRenameMemo, pairRenames, RECALL } from "./renames";

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

// 届き方がばらけても組にする。監視は「消えた」「現れた」を別々の回で
// 渡してくることがあるので、片割れをしばらく覚えておく。
describe("matchRenames", () => {
  const round = (
    memo: ReturnType<typeof newRenameMemo>,
    missing: string[],
    born: string[],
    present: string[],
    now: number,
  ) => matchRenames(memo, { missing, born, present: new Set(present), now });

  it("同じ回に届けば組になる", () => {
    const memo = newRenameMemo();
    expect(round(memo, ["a.md"], ["b.md"], ["b.md"], 0)).toEqual([["a.md", "b.md"]]);
  });

  it("別々の回に届いても組になる", () => {
    const memo = newRenameMemo();
    // 1 回目は消えた片割れだけ
    expect(round(memo, ["a.md"], [], [], 0)).toEqual([]);
    // 2 回目に現れた相手と組む
    expect(round(memo, [], ["b.md"], ["b.md"], 500)).toEqual([["a.md", "b.md"]]);
    // 組んだ分は覚え書きに残らない
    expect(round(memo, [], [], ["b.md"], 600)).toEqual([]);
  });

  it("覚えておく間を過ぎたら組まない", () => {
    const memo = newRenameMemo();
    round(memo, ["a.md"], [], [], 0);
    expect(round(memo, [], ["b.md"], ["b.md"], RECALL + 1)).toEqual([]);
  });

  it("消えた名前が在り直したら忘れる", () => {
    const memo = newRenameMemo();
    round(memo, ["a.md"], [], [], 0);
    // 元に戻された
    round(memo, [], [], ["a.md"], 100);
    expect(round(memo, [], ["b.md"], ["a.md", "b.md"], 200)).toEqual([]);
  });

  it("無関係な作成と削除が続いても組まない", () => {
    const memo = newRenameMemo();
    round(memo, ["a.md", "x.md"], [], [], 0);
    expect(round(memo, [], ["b.md", "y.md"], ["b.md", "y.md"], 100)).toEqual([]);
  });
});

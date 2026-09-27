import { describe, expect, it } from "vitest";
import { listItemAt, listItemRanges } from "./blocks";

const LIST = ["- 一つ目", "- 二つ目", "- 三つ目"].join("\n");

// 子を持つ箇条書き。親の範囲は子を含む。
const NESTED = [
  "- 親A",
  "  - 子A1",
  "  - 子A2",
  "- 親B",
  "- 親C",
].join("\n");

// 記号の続きに本文が折り返している項目。
const WRAPPED = ["- 一つ目", "  続きの行", "- 二つ目"].join("\n");

describe("listItemRanges", () => {
  it("項目ごとの行の範囲を返す", () => {
    expect(listItemRanges(LIST)).toEqual([
      { from: 0, to: 1, indent: 0 },
      { from: 1, to: 2, indent: 0 },
      { from: 2, to: 3, indent: 0 },
    ]);
  });

  it("親の範囲は子を含む", () => {
    expect(listItemRanges(NESTED)).toEqual([
      { from: 0, to: 3, indent: 0 },
      { from: 1, to: 2, indent: 2 },
      { from: 2, to: 3, indent: 2 },
      { from: 3, to: 4, indent: 0 },
      { from: 4, to: 5, indent: 0 },
    ]);
  });

  it("折り返した続きの行は項目に含める", () => {
    expect(listItemRanges(WRAPPED)[0]).toEqual({ from: 0, to: 2, indent: 0 });
  });

  it("番号付きも数える", () => {
    const ordered = ["1. 一つ目", "2. 二つ目"].join("\n");
    expect(listItemRanges(ordered).length).toBe(2);
  });
});

describe("listItemAt", () => {
  it("その位置の項目を返す", () => {
    expect(listItemAt(LIST, LIST.indexOf("二つ目"))?.from).toBe(1);
  });

  it("入れ子では内側の項目を返す", () => {
    expect(listItemAt(NESTED, NESTED.indexOf("子A2"))?.from).toBe(2);
  });

  it("親の記号の行では親を返す", () => {
    expect(listItemAt(NESTED, NESTED.indexOf("親A"))?.from).toBe(0);
  });
});


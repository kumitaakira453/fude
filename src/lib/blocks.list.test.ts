import { describe, expect, it } from "vitest";
import {
  deleteListItem,
  duplicateListItem,
  insertListItem,
  itemTextStart,
  listItemAt,
  listItemRanges,
  dropListItem,
  itemDropRange,
  itemOutOfList,
  splitBlocks,
} from "./blocks";

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

describe("dropListItem", () => {
  it("階層を変えずに下へ動かす", () => {
    expect(dropListItem(LIST, 0, 2, 0)).toBe(
      ["- 二つ目", "- 一つ目", "- 三つ目"].join("\n"),
    );
  });

  it("上へ動かす", () => {
    expect(dropListItem(LIST, 2, 0, 0)).toBe(
      ["- 三つ目", "- 一つ目", "- 二つ目"].join("\n"),
    );
  });

  it("末尾へ動かす", () => {
    expect(dropListItem(LIST, 0, 3, 0)).toBe(
      ["- 二つ目", "- 三つ目", "- 一つ目"].join("\n"),
    );
  });

  it("子を連れて動く", () => {
    expect(dropListItem(NESTED, 0, 4, 0)).toBe(
      ["- 親B", "- 親A", "  - 子A1", "  - 子A2", "- 親C"].join("\n"),
    );
  });

  it("折り返した行も連れて動く", () => {
    expect(dropListItem(WRAPPED, 0, 3, 0)).toBe(
      ["- 二つ目", "- 一つ目", "  続きの行"].join("\n"),
    );
  });

  it("入れ子の中へ落とす。字下げは既にある段に合わせる", () => {
    expect(dropListItem(NESTED, 3, 2, 1)).toBe(
      ["- 親A", "  - 子A1", "  - 親B", "  - 子A2", "- 親C"].join("\n"),
    );
  });

  it("その場で 1 段深くする", () => {
    expect(dropListItem(NESTED, 4, 4, 1)).toBe(
      ["- 親A", "  - 子A1", "  - 子A2", "- 親B", "  - 親C"].join("\n"),
    );
  });

  it("入れ子を外へ出す。子は付いてくる", () => {
    expect(dropListItem(NESTED, 1, 1, 0)).toBe(
      ["- 親A", "- 子A1", "  - 子A2", "- 親B", "- 親C"].join("\n"),
    );
  });

  it("自分の中へは落とさない", () => {
    expect(dropListItem(NESTED, 0, 1, 1)).toBe(NESTED);
  });

  it("動かず深さも変わらないなら元のまま返す", () => {
    expect(dropListItem(LIST, 1, 1, 0)).toBe(LIST);
    expect(dropListItem(LIST, 1, 2, 0)).toBe(LIST);
    expect(dropListItem(WRAPPED, 0, 2, 0)).toBe(WRAPPED);
  });
});

describe("itemDropRange", () => {
  it("いちばん上の隙間は、いちばん外だけ", () => {
    expect(itemDropRange(NESTED, 3, 0)).toEqual({ min: 0, max: 0 });
  });

  it("入れ子の項目のあいだなら、その深さまで入れる", () => {
    expect(itemDropRange(NESTED, 3, 2)).toEqual({ min: 1, max: 2 });
  });

  it("いちばん下の隙間は、いちばん外まで浅くできる", () => {
    expect(itemDropRange(NESTED, 3, 5)).toEqual({ min: 0, max: 1 });
  });
});

describe("deleteListItem / duplicateListItem", () => {
  it("項目を取り除く（子ごと）", () => {
    expect(deleteListItem(NESTED, 0)).toBe(["- 親B", "- 親C"].join("\n"));
  });

  it("最後の 1 項目は残す", () => {
    const one = "- ひとつだけ";
    expect(deleteListItem(one, 0)).toBe(one);
  });

  it("真下に複製する（子ごと）", () => {
    expect(duplicateListItem(NESTED, 0).split("\n").slice(0, 6)).toEqual([
      "- 親A",
      "  - 子A1",
      "  - 子A2",
      "- 親A",
      "  - 子A1",
      "  - 子A2",
    ]);
  });
});

describe("insertListItem", () => {
  it("下に空の項目を差し込む（記号を合わせる）", () => {
    const got = insertListItem(LIST, 0, "after");
    expect(got?.line).toBe(1);
    expect(got?.src.split("\n")).toEqual([
      "- 一つ目",
      "- ",
      "- 二つ目",
      "- 三つ目",
    ]);
  });

  it("上に差し込む", () => {
    const got = insertListItem(LIST, 1, "before");
    expect(got?.line).toBe(1);
    expect(got?.src.split("\n")[1]).toBe("- ");
  });

  it("子の深さに合わせて差し込む", () => {
    const got = insertListItem(NESTED, 1, "after");
    expect(got?.src.split("\n")[2]).toBe("  - ");
  });

  it("番号付きは記号をそのまま写す", () => {
    const ordered = ["1. 一つ目", "2. 二つ目"].join("\n");
    expect(insertListItem(ordered, 0, "after")?.src.split("\n")[1]).toBe("1. ");
  });
});

describe("itemTextStart", () => {
  it("チェックリストはチェックの後ろから", () => {
    expect(itemTextStart("- [ ] やること", 0)).toBe("- [ ] ".length);
  });

  it("記号の直後の位置を返す", () => {
    expect(itemTextStart(LIST, 0)).toBe(2);
    expect(itemTextStart(LIST, 1)).toBe("- 一つ目\n".length + 2);
  });

  it("記号が無い行では null", () => {
    expect(itemTextStart(WRAPPED, 1)).toBeNull();
  });
});

describe("itemOutOfList", () => {
  const DOC = ["前の段落", "", "- 一つ", "  - 中", "- 二つ", "", "後の段落"].join("\n");
  const out = (body: string, index: number, from: number, to: number) =>
    itemOutOfList(body, splitBlocks(body), index, from, to);

  it("いちばん上へ出す。点のまま 1 つの並びになる", () => {
    expect(out(DOC, 1, 2, 0)).toBe(
      ["- 二つ", "", "前の段落", "", "- 一つ", "  - 中", "", "後の段落"].join("\n"),
    );
  });

  it("いちばん下へ出す", () => {
    expect(out(DOC, 1, 2, 3)).toBe(
      ["前の段落", "", "- 一つ", "  - 中", "", "後の段落", "", "- 二つ"].join("\n"),
    );
  });

  it("子は連れていく。字下げはいちばん外に寄る", () => {
    expect(out(DOC, 1, 0, 0)).toBe(
      ["- 一つ", "  - 中", "", "前の段落", "", "- 二つ", "", "後の段落"].join("\n"),
    );
  });

  it("並びが空になったら、その塊ごと消える", () => {
    const one = ["前の段落", "", "- ただ一つ", "", "後の段落"].join("\n");
    expect(out(one, 1, 0, 0)).toBe(
      ["- ただ一つ", "", "前の段落", "", "後の段落"].join("\n"),
    );
  });

  it("元の場所の前後へ出すだけなら、元のまま返す", () => {
    expect(out(DOC, 1, 2, 1)).toBe(DOC);
    expect(out(DOC, 1, 2, 2)).toBe(DOC);
  });
});

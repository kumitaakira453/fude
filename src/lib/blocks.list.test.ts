import { describe, expect, it } from "vitest";
import {
  deleteListItem,
  duplicateListItem,
  insertListItem,
  itemTextStart,
  listItemAt,
  listItemRanges,
  moveListItem,
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

describe("moveListItem", () => {
  it("下へ動かす", () => {
    expect(moveListItem(LIST, 0, 2)).toBe(
      ["- 二つ目", "- 一つ目", "- 三つ目"].join("\n"),
    );
  });

  it("上へ動かす", () => {
    expect(moveListItem(LIST, 2, 0)).toBe(
      ["- 三つ目", "- 一つ目", "- 二つ目"].join("\n"),
    );
  });

  it("末尾へ動かす", () => {
    expect(moveListItem(LIST, 0, 3)).toBe(
      ["- 二つ目", "- 三つ目", "- 一つ目"].join("\n"),
    );
  });

  it("子を連れて動く", () => {
    expect(moveListItem(NESTED, 0, 4)).toBe(
      ["- 親B", "- 親A", "  - 子A1", "  - 子A2", "- 親C"].join("\n"),
    );
  });

  it("折り返した行も連れて動く", () => {
    // 続きの行を含めて 2 行分が 1 項目なので、末尾へは行数（3）を渡す。
    expect(moveListItem(WRAPPED, 0, 3)).toBe(
      ["- 二つ目", "- 一つ目", "  続きの行"].join("\n"),
    );
  });

  it("自分の範囲の直後を指したら動かさない", () => {
    expect(moveListItem(WRAPPED, 0, 2)).toBe(WRAPPED);
  });

  it("深さが違う相手の間には動かさない", () => {
    // 子（深さ 2）を親の位置（深さ 0）へは動かさない
    expect(moveListItem(NESTED, 1, 3)).toBe(NESTED);
  });

  it("同じ位置なら元のまま返す", () => {
    expect(moveListItem(LIST, 1, 1)).toBe(LIST);
    expect(moveListItem(LIST, 1, 2)).toBe(LIST);
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
  it("記号の直後の位置を返す", () => {
    expect(itemTextStart(LIST, 0)).toBe(2);
    expect(itemTextStart(LIST, 1)).toBe("- 一つ目\n".length + 2);
  });

  it("記号が無い行では null", () => {
    expect(itemTextStart(WRAPPED, 1)).toBeNull();
  });
});

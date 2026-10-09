import { describe, expect, it } from "vitest";
import { columnValues, numericColumn, shownRows, type Filters } from "./csvFilter";

// 列ごとの絞り込みと並べ替え。返すのは見出しを除いた行の、元の位置。

const rows = [
  ["名前", "部署", "金額"],
  ["佐藤", "営業", "1,200"],
  ["鈴木", "開発", "300"],
  ["高橋", "営業", "45"],
  ["田中", "", "300"],
  ["伊藤", "開発", "x10"],
];

const f = (text: string, picked: string[] | null = null) => ({
  text,
  picked: picked ? new Set(picked) : null,
  min: null,
  max: null,
});
const range = (min: number | null, max: number | null) => ({ text: "", picked: null, min, max });

describe("shownRows", () => {
  it("条件が無ければ全部を元の順で返す", () => {
    expect(shownRows(rows, {}, null)).toEqual([1, 2, 3, 4, 5]);
  });

  it("含む字で絞る（大小は区別しない）", () => {
    expect(shownRows([["a"], ["Apple"], ["banana"], ["cherry"]], { 0: f("AN") }, null)).toEqual([2]);
  });

  it("選んだ値だけを残す。空も 1 つの値として選べる", () => {
    expect(shownRows(rows, { 1: f("", ["営業", ""]) }, null)).toEqual([1, 3, 4]);
  });

  it("複数の列の条件は、どれも満たす行だけを残す", () => {
    const filters: Filters = { 1: f("", ["営業", "開発"]), 2: f("3") };
    expect(shownRows(rows, filters, null)).toEqual([2]);
  });

  it("数の列は数として並べ、数でない値と混ざれば字の順で比べる", () => {
    expect(shownRows(rows.slice(0, 5), {}, { col: 2, dir: "asc" })).toEqual([3, 2, 4, 1]);
    expect(shownRows(rows.slice(0, 5), {}, { col: 2, dir: "desc" })).toEqual([1, 2, 4, 3]);
  });

  it("同じ値は元の順を保ち、空は向きに関わらず末尾", () => {
    expect(shownRows(rows, {}, { col: 1, dir: "asc" })).toEqual([1, 3, 2, 5, 4]);
    expect(shownRows(rows, {}, { col: 1, dir: "desc" })).toEqual([2, 5, 1, 3, 4]);
  });
});

describe("数の範囲", () => {
  it("以上・以下は両端を含み、片方だけでも効く。カンマ付きも数として読む", () => {
    expect(shownRows(rows, { 2: range(300, null) }, null)).toEqual([1, 2, 4]);
    expect(shownRows(rows, { 2: range(null, 300) }, null)).toEqual([2, 3, 4]);
    expect(shownRows(rows, { 2: range(100, 1000) }, null)).toEqual([2, 4]);
  });

  it("範囲があると、数として読めない値の行は外す", () => {
    expect(shownRows(rows, { 2: range(0, null) }, null)).not.toContain(5);
  });

  it("空でない値がどれも数なら数の列（空は数えない）", () => {
    expect(numericColumn(rows.slice(0, 5), 2)).toBe(true);
    expect(numericColumn(rows, 2)).toBe(false);
    expect(numericColumn([["a"], [""], [" "]], 0)).toBe(false);
  });
});

describe("columnValues", () => {
  it("値ごとの件数を値の順で返し、空は末尾", () => {
    expect(columnValues(rows, 1)).toEqual([
      { value: "営業", count: 2 },
      { value: "開発", count: 2 },
      { value: "", count: 1 },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { colName, csvLines, csvRows, delimOf } from "./csv";

describe("区切りの字", () => {
  it("拡張子で決める", () => {
    expect(delimOf("a/表.csv")).toBe(",");
    expect(delimOf("表.TSV")).toBe("\t");
    expect(delimOf("表.txt")).toBeNull();
  });
});

describe("列の名前", () => {
  it("Z の次は AA", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(colName)).toEqual([
      "A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA",
    ]);
  });
});

describe("表の値", () => {
  it("囲みの中の区切りと改行は値の一部で、\"\" は \" 1 字", () => {
    expect(csvRows('名前,メモ\n"山田, 太郎","1 行目\n2 行目 ""引用"""\n', ",")).toEqual([
      ["名前", "メモ"],
      ["山田, 太郎", '1 行目\n2 行目 "引用"'],
    ]);
  });

  it("列の数がそろわない行は空で埋める", () => {
    expect(csvRows("a,b,c\n1\n1,2", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
      ["1", "2", ""],
    ]);
  });

  it("CRLF を読み、末尾の改行の後ろに空の行を作らない", () => {
    expect(csvRows("a,b\r\n1,2\r\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("空の値と、値の途中の \" はそのまま", () => {
    expect(csvRows('a,,5"インチ\n', ",")).toEqual([["a", "", '5"インチ']]);
  });

  it("TSV はタブで区切る（カンマは値の一部）", () => {
    expect(csvRows("a,b\tc\n", "\t")).toEqual([["a,b", "c"]]);
  });

  it("空のファイルは行を持たない", () => {
    expect(csvRows("", ",")).toEqual([]);
  });
});

describe("原文の色分け", () => {
  const cols = (text: string) =>
    csvLines(text, ",").map((line) => line.map((p) => [p.text, p.cls]));

  it("値ごとに列の色を付け、区切りには付けない", () => {
    expect(cols("a,b\n1,2")).toEqual([
      [["a", "mg-csv-c0"], [",", null], ["b", "mg-csv-c1"]],
      [["1", "mg-csv-c0"], [",", null], ["2", "mg-csv-c1"]],
    ]);
  });

  it("囲みの中の区切りは値の色のまま、改行で割れても列の番号は続く", () => {
    expect(cols('a,"x,\ny",b')).toEqual([
      [["a", "mg-csv-c0"], [",", null], ['"x,', "mg-csv-c1"]],
      [['y"', "mg-csv-c1"], [",", null], ["b", "mg-csv-c2"]],
    ]);
  });

  it("8 列目で最初の色に戻る", () => {
    const line = csvLines("0,1,2,3,4,5,6,7", ",")[0].filter((p) => p.cls);
    expect(line.map((p) => p.cls).slice(6)).toEqual(["mg-csv-c6", "mg-csv-c0"]);
  });

  it("原文の字をそのまま残す（行ごとにつなぐと元の行になる）", () => {
    const text = 'a,"b ""c""",d\n1,,3';
    expect(csvLines(text, ",").map((l) => l.map((p) => p.text).join(""))).toEqual(
      text.split("\n"),
    );
  });
});

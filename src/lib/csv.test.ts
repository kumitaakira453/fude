import { describe, expect, it } from "vitest";
import {
  colName,
  colsDeleted,
  colsInserted,
  colsUndeleted,
  colsUninserted,
  csvLines,
  csvRows,
  deleteColumns,
  deleteRows,
  delimOf,
  insertColumns,
  insertRows,
  movedIndex,
  moveColumn,
  setCell,
  setCells,
} from "./csv";

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

describe("値を 1 つ書き換える", () => {
  it("その値だけを差し替え、ほかの囲み・改行の字・末尾の改行はそのまま", () => {
    const text = '名前,住所\r\n"山田",東京\r\n鈴木,"大阪, 北区"\r\n';
    expect(setCell(text, ",", 1, 1, "京都")).toBe('名前,住所\r\n"山田",京都\r\n鈴木,"大阪, 北区"\r\n');
  });

  it("区切り・\"・改行を含む値は囲み、\" は 2 つにする。改行はファイルの改行にそろえる", () => {
    const crlf = "a,b\r\n1,2\r\n";
    expect(setCell(crlf, ",", 1, 0, "x,y")).toBe('a,b\r\n"x,y",2\r\n');
    expect(setCell(crlf, ",", 1, 0, 'say "hi"')).toBe('a,b\r\n"say ""hi""",2\r\n');
    expect(setCell(crlf, ",", 1, 0, "1行目\n2行目")).toBe('a,b\r\n"1行目\r\n2行目",2\r\n');
    expect(setCell("a,b\n1,2", ",", 1, 1, "上\n下")).toBe('a,b\n1,"上\n下"');
  });

  it("元が囲みなら、囲む要の無い値でも囲んだまま書く", () => {
    expect(setCell('"a","b"\n', ",", 0, 1, "c")).toBe('"a","c"\n');
  });

  it("列の足りない短い行は区切りを足して埋める", () => {
    expect(setCell("a,b,c\n1\n", ",", 1, 2, "x")).toBe("a,b,c\n1,,x\n");
  });

  it("囲みの中に改行がある値の後ろの行も、行の番号を取り違えない", () => {
    const text = 'a,b\n"1\n2",3\n4,5\n';
    expect(setCell(text, ",", 2, 0, "x")).toBe('a,b\n"1\n2",3\nx,5\n');
  });

  it("TSV でも書け、読み直すと入れた値が出る", () => {
    const text = "名前\t点\n佐藤\t90\n";
    const next = setCell(text, "\t", 1, 0, "タブ\tを含む");
    expect(csvRows(next, "\t")).toEqual([
      ["名前", "点"],
      ["タブ\tを含む", "90"],
    ]);
  });

  it("無い行は原文のまま", () => {
    expect(setCell("a\n", ",", 3, 0, "x")).toBe("a\n");
  });
});

describe("列を動かす", () => {
  it("左へ・右へ動かし、値の原文と改行の字・末尾の改行はそのまま", () => {
    const text = 'a,b,c\r\n1,"2, 二",3\r\n';
    expect(moveColumn(text, ",", 0, 2)).toBe('b,c,a\r\n"2, 二",3,1\r\n');
    expect(moveColumn(text, ",", 2, 0)).toBe('c,a,b\r\n3,1,"2, 二"\r\n');
  });

  it("囲みの中の改行は値の一部として一緒に動く", () => {
    const text = 'a,b\n"1\n2",3\n4,5';
    expect(moveColumn(text, ",", 1, 0)).toBe('b,a\n3,"1\n2"\n5,4');
  });

  it("短い行は空の値で埋めてから動かす", () => {
    expect(moveColumn("a,b,c\n1\n", ",", 2, 0)).toBe("c,a,b\n,1,\n");
  });

  it("TSV でも動かせ、同じ位置なら原文のまま", () => {
    expect(moveColumn("a\tb\n1\t2\n", "\t", 1, 0)).toBe("b\ta\n2\t1\n");
    expect(moveColumn("a,b\n", ",", 1, 1)).toBe("a,b\n");
  });

  it("動かしたあとの列の位置", () => {
    // A B C D の B を 3 番目（D の位置）へ → A C D B
    expect([0, 1, 2, 3].map((i) => movedIndex(i, 1, 3))).toEqual([0, 3, 1, 2]);
    // D を 1 番目へ → A D B C
    expect([0, 1, 2, 3].map((i) => movedIndex(i, 3, 1))).toEqual([0, 2, 3, 1]);
  });
});

describe("値をまとめて入れる・行と列を足す・消す", () => {
  const crlf = 'a,b\r\n"1",2\r\n3,4\r\n';

  it("まとめて入れても、ほかの値の囲みと改行の字はそのまま。無い行は末尾に足す", () => {
    expect(
      setCells(crlf, ",", [
        { row: 1, col: 1, value: "x" },
        { row: 2, col: 0, value: "y,z" },
        { row: 3, col: 1, value: "新" },
      ]),
    ).toBe('a,b\r\n"1",x\r\n"y,z",4\r\n,新\r\n');
    expect(setCells("a,b\n1,2", ",", [{ row: 2, col: 0, value: "末" }])).toBe("a,b\n1,2\n末");
  });

  it("行を足す・消す。末尾の改行が無いファイルでも崩れない", () => {
    expect(insertRows(crlf, ",", 1, 2)).toBe('a,b\r\n,\r\n,\r\n"1",2\r\n3,4\r\n');
    expect(insertRows("a,b\n1,2", ",", 2, 1)).toBe("a,b\n1,2\n,");
    expect(deleteRows(crlf, ",", [1])).toBe("a,b\r\n3,4\r\n");
    expect(deleteRows("a,b\n1,2\n3,4", ",", [2])).toBe("a,b\n1,2\n");
  });

  it("囲みの中の改行を含む行を消しても、ほかの行は取り違えない", () => {
    expect(deleteRows('a\n"x\ny"\nz\n', ",", [1])).toBe("a\nz\n");
  });

  it("列を足す・消す。短い行は列の数まで埋める", () => {
    expect(insertColumns("a,b\n1\n", ",", 1, 1)).toBe("a,,b\n1,,\n");
    expect(insertColumns("a\tb\n1\t2\n", "\t", 2, 2)).toBe("a\tb\t\t\n1\t2\t\t\n");
    expect(deleteColumns('a,b,c\n1,"2,2",3\n', ",", [1])).toBe("a,c\n1,3\n");
    expect(deleteColumns("a,b,c\n1\n", ",", [0, 2])).toBe("b\n\n");
  });

  it("読み直すと、足した・消したとおりに並ぶ", () => {
    const next = deleteColumns(insertRows("名前,点\n佐藤,90\n", ",", 1, 1), ",", [1]);
    expect(csvRows(next, ",")).toEqual([["名前"], [""], ["佐藤"]]);
  });

  it("列の番号の付け替えと、その逆", () => {
    const ins = colsInserted(1, 2);
    expect([0, 1, 2].map(ins)).toEqual([0, 3, 4]);
    expect([0, 1, 2, 3, 4].map(colsUninserted(1, 2))).toEqual([0, null, null, 1, 2]);
    const del = colsDeleted([1, 3]);
    expect([0, 1, 2, 3, 4].map(del)).toEqual([0, null, 1, null, 2]);
    expect([0, 1, 2].map(colsUndeleted([1, 3]))).toEqual([0, 2, 4]);
  });
});

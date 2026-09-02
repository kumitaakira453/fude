import { describe, expect, it } from "vitest";
import {
  appendTableColumn,
  appendTableRow,
  clearTableColumn,
  clearTableRow,
  deleteTableColumn,
  deleteTableRow,
  duplicateTableColumn,
  duplicateTableRow,
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  moveTableRow,
} from "./blocks";

const TABLE = [
  "| 名前 | 型 | 説明 |",
  "| --- | :---: | ---: |",
  "| id | number | 識別子 |",
  "| name | string | 表示名 |",
  "| age | number | 年齢 |",
].join("\n");

const BARE = ["a | b | c", "--- | --- | ---", "1 | 2 | 3"].join("\n");

describe("moveTableRow", () => {
  it("下へ動かす", () => {
    expect(moveTableRow(TABLE, 2, 4)).toBe(
      [
        "| 名前 | 型 | 説明 |",
        "| --- | :---: | ---: |",
        "| name | string | 表示名 |",
        "| id | number | 識別子 |",
        "| age | number | 年齢 |",
      ].join("\n"),
    );
  });

  it("上へ動かす", () => {
    expect(moveTableRow(TABLE, 4, 2)).toBe(
      [
        "| 名前 | 型 | 説明 |",
        "| --- | :---: | ---: |",
        "| age | number | 年齢 |",
        "| id | number | 識別子 |",
        "| name | string | 表示名 |",
      ].join("\n"),
    );
  });

  it("末尾へ動かす", () => {
    expect(moveTableRow(TABLE, 2, 5).split("\n")[4]).toBe(
      "| id | number | 識別子 |",
    );
  });

  it("見出しと区切りは動かせない", () => {
    expect(moveTableRow(TABLE, 0, 3)).toBe(TABLE);
    expect(moveTableRow(TABLE, 1, 3)).toBe(TABLE);
  });

  it("見出しや区切りの位置へは差し込めない", () => {
    expect(moveTableRow(TABLE, 3, 0)).toBe(TABLE);
    expect(moveTableRow(TABLE, 3, 1)).toBe(TABLE);
  });

  it("同じ位置なら元のまま返す", () => {
    expect(moveTableRow(TABLE, 3, 3)).toBe(TABLE);
    expect(moveTableRow(TABLE, 3, 4)).toBe(TABLE);
  });

  it("範囲外なら元のまま返す", () => {
    expect(moveTableRow(TABLE, 9, 2)).toBe(TABLE);
    expect(moveTableRow(TABLE, 2, 9)).toBe(TABLE);
  });
});

describe("moveTableColumn", () => {
  it("先頭の列を末尾へ動かす（寄せも一緒に動く）", () => {
    expect(moveTableColumn(TABLE, 0, 3)).toBe(
      [
        "| 型 | 説明 | 名前 |",
        "| :---: | ---: | --- |",
        "| number | 識別子 | id |",
        "| string | 表示名 | name |",
        "| number | 年齢 | age |",
      ].join("\n"),
    );
  });

  it("列を 1 つ左へ動かす", () => {
    expect(moveTableColumn(TABLE, 2, 1)).toBe(
      [
        "| 名前 | 説明 | 型 |",
        "| --- | ---: | :---: |",
        "| id | 識別子 | number |",
        "| name | 表示名 | string |",
        "| age | 年齢 | number |",
      ].join("\n"),
    );
  });

  it("先頭の | が無い表でも中身が入れ替わる", () => {
    const got = moveTableColumn(BARE, 0, 2);
    expect(got.split("\n")[0].split("|").map((s) => s.trim())).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(got.split("\n")[2].split("|").map((s) => s.trim())).toEqual([
      "2",
      "1",
      "3",
    ]);
  });

  it("同じ位置なら元のまま返す", () => {
    expect(moveTableColumn(TABLE, 1, 1)).toBe(TABLE);
    expect(moveTableColumn(TABLE, 1, 2)).toBe(TABLE);
  });

  it("列が欠けている行は触らない", () => {
    const ragged = ["| a | b | c |", "|---|---|---|", "| 1 |"].join("\n");
    const got = moveTableColumn(ragged, 0, 2).split("\n");
    expect(got[0]).toBe("| b | a | c |");
    expect(got[2]).toBe("| 1 |");
  });

  it("エスケープした | は区切りとして数えない", () => {
    const src = ["| a | b |", "|---|---|", "| x \\| y | z |"].join("\n");
    expect(moveTableColumn(src, 0, 2).split("\n")[2]).toBe("| z | x \\| y |");
  });

  it("範囲外なら元のまま返す", () => {
    expect(moveTableColumn(TABLE, -1, 2)).toBe(TABLE);
    expect(moveTableColumn(TABLE, 0, 9)).toBe(TABLE);
  });
});

describe("appendTableRow", () => {
  it("列の数を合わせた空の行を末尾に足す", () => {
    expect(appendTableRow(TABLE).split("\n")[5]).toBe("|  |  |  |");
  });

  it("先頭の | が無い表では同じ書き方で足す", () => {
    expect(appendTableRow(BARE).split("\n")[3]).toBe("  |  |  ");
  });

  it("元の行は変えない", () => {
    const got = appendTableRow(TABLE).split("\n");
    expect(got.slice(0, 5).join("\n")).toBe(TABLE);
  });
});

describe("appendTableColumn", () => {
  it("末尾に空の列を足し、区切り行にも区切りを入れる", () => {
    const got = appendTableColumn(TABLE).split("\n");
    expect(got[0]).toBe("| 名前 | 型 | 説明 |  |");
    expect(got[1]).toBe("| --- | :---: | ---: | --- |");
    expect(got[2]).toBe("| id | number | 識別子 |  |");
  });

  it("先頭の | が無い表では末尾に付け足す", () => {
    const got = appendTableColumn(BARE).split("\n");
    expect(got[0]).toBe("a | b | c|  ");
    expect(got[1]).toBe("--- | --- | ---| --- ");
  });
});

describe("deleteTableRow", () => {
  it("本体の行を取り除く", () => {
    expect(deleteTableRow(TABLE, 3)).toBe(
      [
        "| 名前 | 型 | 説明 |",
        "| --- | :---: | ---: |",
        "| id | number | 識別子 |",
        "| age | number | 年齢 |",
      ].join("\n"),
    );
  });

  it("見出しと区切りは消せない", () => {
    expect(deleteTableRow(TABLE, 0)).toBe(TABLE);
    expect(deleteTableRow(TABLE, 1)).toBe(TABLE);
  });

  it("範囲外では元のまま返す", () => {
    expect(deleteTableRow(TABLE, 9)).toBe(TABLE);
  });
});

describe("deleteTableColumn", () => {
  it("列を取り除く（区切り行の寄せも一緒に消える）", () => {
    const got = deleteTableColumn(TABLE, 1).split("\n");
    expect(got[0]).toBe("| 名前 | 説明 |");
    expect(got[1]).toBe("| --- | ---: |");
    expect(got[2]).toBe("| id | 識別子 |");
  });

  it("先頭の列も取り除ける", () => {
    expect(deleteTableColumn(TABLE, 0).split("\n")[0]).toBe("| 型 | 説明 |");
  });

  it("最後の 1 列は残す", () => {
    const one = ["| a |", "|---|", "| 1 |"].join("\n");
    expect(deleteTableColumn(one, 0)).toBe(one);
  });

  it("列が足りない行は触らない", () => {
    const ragged = ["| a | b | c |", "|---|---|---|", "| 1 |"].join("\n");
    expect(deleteTableColumn(ragged, 2).split("\n")[2]).toBe("| 1 |");
  });
});

describe("insertTableRow / insertTableColumn", () => {
  it("指定の行番号に空の行を差し込む", () => {
    const got = insertTableRow(TABLE, 3).split("\n");
    expect(got[2]).toBe("| id | number | 識別子 |");
    expect(got[3]).toBe("|  |  |  |");
    expect(got[4]).toBe("| name | string | 表示名 |");
  });

  it("見出しや区切りの位置には差し込めない", () => {
    expect(insertTableRow(TABLE, 1)).toBe(TABLE);
  });

  it("指定の列番号に空の列を差し込む", () => {
    const got = insertTableColumn(TABLE, 1).split("\n");
    expect(got[0]).toBe("| 名前 |  | 型 | 説明 |");
    expect(got[1]).toBe("| --- | --- | :---: | ---: |");
    expect(got[2]).toBe("| id |  | number | 識別子 |");
  });

  it("列数と同じ番号なら末尾に足す", () => {
    expect(insertTableColumn(TABLE, 3).split("\n")[0]).toBe(
      "| 名前 | 型 | 説明 |  |",
    );
  });

  it("列数を超える番号では元のまま返す", () => {
    expect(insertTableColumn(TABLE, 4)).toBe(TABLE);
  });
});

describe("duplicateTableRow / duplicateTableColumn", () => {
  it("行を真下に複製する", () => {
    const got = duplicateTableRow(TABLE, 2).split("\n");
    expect(got[2]).toBe("| id | number | 識別子 |");
    expect(got[3]).toBe("| id | number | 識別子 |");
    expect(got[4]).toBe("| name | string | 表示名 |");
  });

  it("列を右隣に複製する（区切りも複製する）", () => {
    const got = duplicateTableColumn(TABLE, 1).split("\n");
    expect(got[0]).toBe("| 名前 | 型 | 型 | 説明 |");
    expect(got[1]).toBe("| --- | :---: | :---: | ---: |");
    expect(got[2]).toBe("| id | number | number | 識別子 |");
  });

  it("範囲外では元のまま返す", () => {
    expect(duplicateTableRow(TABLE, 1)).toBe(TABLE);
    expect(duplicateTableColumn(TABLE, 3)).toBe(TABLE);
  });
});

describe("clearTableRow / clearTableColumn", () => {
  it("行の中身だけを空にする", () => {
    const got = clearTableRow(TABLE, 2).split("\n");
    expect(got[2]).toBe("|  |  |  |");
    expect(got[3]).toBe("| name | string | 表示名 |");
  });

  it("列の中身を空にし、見出しは残す", () => {
    const got = clearTableColumn(TABLE, 1).split("\n");
    expect(got[0]).toBe("| 名前 | 型 | 説明 |");
    expect(got[1]).toBe("| --- | :---: | ---: |");
    expect(got[2]).toBe("| id |  | 識別子 |");
    expect(got[3]).toBe("| name |  | 表示名 |");
  });

  it("見出しと区切りの行は消せない", () => {
    expect(clearTableRow(TABLE, 0)).toBe(TABLE);
    expect(clearTableRow(TABLE, 1)).toBe(TABLE);
  });
});

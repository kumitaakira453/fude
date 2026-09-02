import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import {
  cellFromStart,
  cellStartAt,
  itemTextRange,
  unitAt,
} from "./blocks";

// セルの座標だけを見る（cellStart は別の試験でパーサと突き合わせる）
const coords = (src: string, offset: number) => {
  const u = unitAt(src, offset);
  return u.kind === "cell"
    ? { kind: u.kind, lineIndex: u.lineIndex, colIndex: u.colIndex }
    : u;
};

// remark が tableCell に付ける開始オフセットを集める
function parsedCellStarts(src: string): number[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(src) as never;
  const found: number[] = [];
  const walk = (n: {
    type?: string;
    position?: { start?: { offset?: number } };
    children?: unknown[];
  }) => {
    if (n.type === "tableCell" && n.position?.start?.offset !== undefined) {
      found.push(n.position.start.offset);
    }
    for (const c of (n.children ?? []) as never[]) walk(c);
  };
  walk(tree);
  return found;
}

// 表の位置を「行番号と列番号」で数えるので、ソース中の文字位置を
// 探して渡す。実際の呼び出し側も選択範囲の開始位置を渡す。
const at = (src: string, needle: string) => src.indexOf(needle);

const TABLE = ["| 名前 | 型 | 説明 |", "| --- | --- | --- |", "| id | number | 識別子 |", "| name | string | 表示名 |"].join(
  "\n",
);

describe("unitAt（表）", () => {
  it("見出し行の各列を指す", () => {
    expect(coords(TABLE, at(TABLE, "名前"))).toEqual({
      kind: "cell",
      lineIndex: 0,
      colIndex: 0,
    });
    expect(coords(TABLE, at(TABLE, "説明"))).toEqual({
      kind: "cell",
      lineIndex: 0,
      colIndex: 2,
    });
  });

  it("本文行の行番号と列番号が合う", () => {
    expect(coords(TABLE, at(TABLE, "number"))).toEqual({
      kind: "cell",
      lineIndex: 2,
      colIndex: 1,
    });
    expect(coords(TABLE, at(TABLE, "表示名"))).toEqual({
      kind: "cell",
      lineIndex: 3,
      colIndex: 2,
    });
  });

  it("区切り行はブロック全体に落ちる", () => {
    // 区切り行を選んでも編集するセルが無い
    expect(coords(TABLE, at(TABLE, "| --- |") + 3)).toEqual({ kind: "block" });
  });

  it("エスケープした縦棒は列の区切りにしない", () => {
    const src = ["| 記号 | 意味 |", "| --- | --- |", "| \\| | 縦棒そのもの |"].join("\n");
    expect(coords(src, at(src, "縦棒そのもの"))).toEqual({
      kind: "cell",
      lineIndex: 2,
      colIndex: 1,
    });
  });
});

describe("unitAt（表の cellStart）", () => {
  it("パーサが tableCell に付ける開始位置と一致する", () => {
    // ここが食い違うと、画面はセル編集の対象を見つけられず何も起きない。
    const starts = parsedCellStarts(TABLE);
    expect(starts.length).toBe(9);
    const cells = [
      "名前", "型", "説明",
      "id", "number", "識別子",
      "name", "string", "表示名",
    ];
    const got = cells.map((needle) => {
      const u = unitAt(TABLE, at(TABLE, needle));
      return u.kind === "cell" ? u.cellStart : -1;
    });
    expect(got).toEqual(starts);
  });

  it("先頭の縦棒が無い行でも一致する", () => {
    const src = ["名前 | 型", "--- | ---", "id | number"].join("\n");
    const starts = parsedCellStarts(src);
    const got = ["名前", "型", "id", "number"].map((needle) => {
      const u = unitAt(src, at(src, needle));
      return u.kind === "cell" ? u.cellStart : -1;
    });
    expect(got).toEqual(starts);
  });
});

describe("unitAt（箇条書き）", () => {
  const LIST = ["- 一つめ", "- 二つめ", "  - 入れ子", "1. 番号つき"].join("\n");

  it("項目の本文だけを指す（マーカーを含まない）", () => {
    const u = unitAt(LIST, at(LIST, "二つめ"));
    expect(u.kind).toBe("item");
    if (u.kind !== "item") return;
    expect(LIST.slice(u.start, u.end)).toBe("二つめ");
  });

  it("入れ子の項目も、その行だけを指す", () => {
    const u = unitAt(LIST, at(LIST, "入れ子"));
    expect(u.kind).toBe("item");
    if (u.kind !== "item") return;
    expect(LIST.slice(u.start, u.end)).toBe("入れ子");
  });

  it("番号つきの項目も扱う", () => {
    const u = unitAt(LIST, at(LIST, "番号つき"));
    expect(u.kind).toBe("item");
    if (u.kind !== "item") return;
    expect(LIST.slice(u.start, u.end)).toBe("番号つき");
  });

  it("チェックボックスは本文に含めない", () => {
    const src = "- [x] 済んだこと";
    const u = unitAt(src, at(src, "済んだ"));
    expect(u.kind).toBe("item");
    if (u.kind !== "item") return;
    expect(src.slice(u.start, u.end)).toBe("済んだこと");
  });

  it("マーカーの無い継続行はブロック全体に落ちる", () => {
    const src = ["- 一つめ", "  続きの行", ""].join("\n");
    expect(unitAt(src, at(src, "続きの行"))).toEqual({ kind: "block" });
  });
});

describe("unitAt（その他）", () => {
  it("段落はブロック全体", () => {
    const src = "ただの段落です。";
    expect(unitAt(src, 3)).toEqual({ kind: "block" });
  });

  it("範囲外の位置でも落ちない", () => {
    const src = "- 一つめ";
    expect(unitAt(src, -100).kind).toBe("item");
    expect(unitAt(src, 9999).kind).toBe("item");
    expect(unitAt(src, Number.NaN).kind).toBe("item");
  });

  it("空の文字列でも落ちない", () => {
    expect(unitAt("", 0)).toEqual({ kind: "block" });
  });
});

describe("itemTextRange", () => {
  it("末尾の空白を範囲に含めない", () => {
    const src = "- 一つめ   ";
    const r = itemTextRange(src, 4);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(src.slice(r.start, r.end)).toBe("一つめ");
  });

  it("本文が空の項目は範囲を返さない", () => {
    expect(itemTextRange("-   ", 2)).toBeNull();
  });
});

// 描画側が目印に載せるのはパーサが付ける開始位置（直前の | の位置）。
// その値から同じセルへ戻れないと、選んだ場所と違うセルが編集される。
describe("cellFromStart（目印からの往復）", () => {
  const TABLES = [
    TABLE,
    ["a | b | c", "--- | --- | ---", "1 | 2 | 3"].join("\n"),
    ["| 空 |  | 埋 |", "|---|---|---|", "| 1 |  | 3 |"].join("\n"),
  ];

  it("パーサの開始位置から元のセルへ戻れる", () => {
    for (const src of TABLES) {
      const starts = parsedCellStarts(src);
      expect(starts.length).toBeGreaterThan(0);
      for (const start of starts) {
        const unit = cellFromStart(src, start);
        expect(unit).not.toBeNull();
        if (!unit || unit.kind !== "cell") continue;
        // 戻った行と列から作り直した開始位置が、元の値と一致する
        expect(unit.cellStart).toBe(start);
      }
    }
  });

  it("表でない文字列では null", () => {
    expect(cellFromStart("ただの段落。", 2)).toBeNull();
  });
});

// 空のセルは選ぶ文字が無いので、行番号と列番号から開く必要がある。
describe("cellStartAt", () => {
  it("パーサが付ける開始位置と一致する", () => {
    const starts = parsedCellStarts(TABLE);
    const got: number[] = [];
    for (const line of [0, 2, 3]) {
      for (const col of [0, 1, 2]) {
        const at = cellStartAt(TABLE, line, col);
        if (at !== null) got.push(at);
      }
    }
    expect(got).toEqual(starts);
  });

  it("先頭の | が無い表でも一致する", () => {
    const bare = ["a | b", "--- | ---", "1 | 2"].join("\n");
    const starts = parsedCellStarts(bare);
    const got = [
      cellStartAt(bare, 0, 0),
      cellStartAt(bare, 0, 1),
      cellStartAt(bare, 2, 0),
      cellStartAt(bare, 2, 1),
    ];
    expect(got).toEqual(starts);
  });

  it("空のセルでも位置が出る", () => {
    const src = ["| a | b |", "|---|---|", "|  |  |"].join("\n");
    const at = cellStartAt(src, 2, 0);
    expect(at).not.toBeNull();
    const unit = at === null ? null : cellFromStart(src, at);
    expect(unit?.colIndex).toBe(0);
    expect(unit?.lineIndex).toBe(2);
  });

  it("範囲外では null", () => {
    expect(cellStartAt(TABLE, 9, 0)).toBeNull();
    expect(cellStartAt(TABLE, 0, 9)).toBeNull();
  });
});

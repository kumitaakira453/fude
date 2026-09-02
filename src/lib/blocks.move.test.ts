import { describe, expect, it } from "vitest";
import {
  cutBlock,
  insertAfter,
  insertBefore,
  moveBlock,
  remapAfterMove,
  splitBlocks,
} from "./blocks";

const BODY = ["# 見出し", "", "一つ目の段落。", "", "二つ目の段落。", "", "三つ目の段落。"].join("\n");

const move = (body: string, from: number, to: number) =>
  moveBlock(body, splitBlocks(body), from, to);

describe("moveBlock", () => {
  it("下へ動かす", () => {
    expect(move(BODY, 1, 3)).toBe(
      ["# 見出し", "", "二つ目の段落。", "", "一つ目の段落。", "", "三つ目の段落。"].join("\n"),
    );
  });

  it("上へ動かす", () => {
    expect(move(BODY, 3, 1)).toBe(
      ["# 見出し", "", "三つ目の段落。", "", "一つ目の段落。", "", "二つ目の段落。"].join("\n"),
    );
  });

  it("先頭へ動かしても書き出しに空行が残らない", () => {
    expect(move(BODY, 2, 0)).toBe(
      ["二つ目の段落。", "", "# 見出し", "", "一つ目の段落。", "", "三つ目の段落。"].join("\n"),
    );
  });

  it("末尾へ動かす", () => {
    expect(move(BODY, 0, 4)).toBe(
      ["一つ目の段落。", "", "二つ目の段落。", "", "三つ目の段落。", "", "# 見出し"].join("\n"),
    );
  });

  it("同じ位置なら元のまま返す", () => {
    expect(move(BODY, 1, 1)).toBe(BODY);
    expect(move(BODY, 1, 2)).toBe(BODY);
  });

  it("範囲外なら元のまま返す", () => {
    expect(move(BODY, -1, 2)).toBe(BODY);
    expect(move(BODY, 9, 2)).toBe(BODY);
    expect(move(BODY, 1, 99)).toBe(BODY);
  });

  it("動かしていないブロックの中身は 1 文字も変わらない", () => {
    const body = ["| a | b |", "|---|---|", "| 1 | 2 |", "", "段落。", "", "```ts", "const x = 1;", "```"].join("\n");
    const got = move(body, 1, 0);
    expect(got).toContain("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(got).toContain("```ts\nconst x = 1;\n```");
    expect(got.startsWith("段落。")).toBe(true);
  });

  // 隙間は後ろのブロックに付いて動く。先頭へ来たものだけは書き出しに揃える。
  it("広い隙間はそのブロックに付いて動く", () => {
    const body = ["一つ目。", "", "", "", "二つ目。", "", "三つ目。"].join("\n");
    expect(move(body, 2, 1)).toBe(
      ["一つ目。", "", "三つ目。", "", "", "", "二つ目。"].join("\n"),
    );
  });

  it("先頭へ来たブロックの隙間は書き出しに揃える", () => {
    const body = ["一つ目。", "", "", "", "二つ目。", "", "三つ目。"].join("\n");
    expect(move(body, 0, 2)).toBe(
      ["二つ目。", "", "一つ目。", "", "三つ目。"].join("\n"),
    );
  });

  it("末尾の改行を保つ", () => {
    const body = "一つ目。\n\n二つ目。\n";
    expect(move(body, 0, 2)).toBe("二つ目。\n\n一つ目。\n");
  });
});

describe("remapAfterMove", () => {
  it("動かしたブロック自身の行き先", () => {
    expect(remapAfterMove(1, 1, 3)).toBe(2);
    expect(remapAfterMove(3, 3, 1)).toBe(1);
  });

  it("間に挟まれたブロックがずれる", () => {
    // 1 を 3 の前へ動かすと、2 は 1 へ繰り上がる
    expect(remapAfterMove(2, 1, 3)).toBe(1);
    // 3 を 1 の前へ動かすと、1 と 2 は 1 つ下がる
    expect(remapAfterMove(1, 3, 1)).toBe(2);
    expect(remapAfterMove(2, 3, 1)).toBe(3);
  });

  it("範囲の外は動かない", () => {
    expect(remapAfterMove(0, 1, 3)).toBe(0);
    expect(remapAfterMove(5, 1, 3)).toBe(5);
    expect(remapAfterMove(0, 3, 1)).toBe(0);
    expect(remapAfterMove(4, 3, 1)).toBe(4);
  });
});

describe("insertAfter / insertBefore", () => {
  const blocks = splitBlocks(BODY);

  it("直後に空行を挟んで差し込む", () => {
    expect(insertAfter(BODY, blocks[0], "新しい行。")).toBe(
      ["# 見出し", "", "新しい行。", "", "一つ目の段落。", "", "二つ目の段落。", "", "三つ目の段落。"].join("\n"),
    );
  });

  it("直前に空行を挟んで差し込む", () => {
    expect(insertBefore(BODY, blocks[0], "新しい行。")).toBe(
      ["新しい行。", "", "# 見出し", "", "一つ目の段落。", "", "二つ目の段落。", "", "三つ目の段落。"].join("\n"),
    );
  });

  it("末尾のブロックの後ろにも差し込める", () => {
    const last = blocks[blocks.length - 1];
    expect(insertAfter(BODY, last, "新しい行。").endsWith("三つ目の段落。\n\n新しい行。")).toBe(true);
  });
});

describe("cutBlock", () => {
  const blocks = splitBlocks(BODY);

  it("継ぎ目の空行を畳む", () => {
    expect(cutBlock(BODY, blocks[1])).toBe(
      ["# 見出し", "", "二つ目の段落。", "", "三つ目の段落。"].join("\n"),
    );
  });

  it("先頭のブロックを取り除く", () => {
    expect(cutBlock(BODY, blocks[0])).toBe(
      ["一つ目の段落。", "", "二つ目の段落。", "", "三つ目の段落。"].join("\n"),
    );
  });

  it("末尾のブロックを取り除く", () => {
    expect(cutBlock(BODY, blocks[blocks.length - 1])).toBe(
      ["# 見出し", "", "一つ目の段落。", "", "二つ目の段落。"].join("\n"),
    );
  });

  it("最後の 1 つを取り除くと空になる", () => {
    const only = "ひとつだけ。";
    expect(cutBlock(only, splitBlocks(only)[0])).toBe("");
  });
});

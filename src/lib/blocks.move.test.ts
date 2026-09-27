import { describe, expect, it } from "vitest";
import { insertAfter, insertBefore, splitBlocks } from "./blocks";

const BODY = ["# 見出し", "", "一つ目の段落。", "", "二つ目の段落。", "", "三つ目の段落。"].join("\n");

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


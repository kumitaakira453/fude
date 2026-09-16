import { describe, expect, it } from "vitest";
import { lineRange, splitBlocks } from "./blocks";

// ブロックがファイルの何行目に在るか。指摘の居場所として人とエージェントに
// 渡すので、1 始まりで、フロントマターのぶんだけずらせること。

const BODY = `# 題

はじめの段落。

- ひとつ
- ふたつ

おわりの段落。
`;

describe("lineRange", () => {
  const blocks = splitBlocks(BODY);

  it("頭のブロックは 1 行目", () => {
    expect(lineRange(BODY, blocks[0])).toEqual({ from: 1, to: 1 });
  });

  it("空行を数えた先の行を出す", () => {
    expect(lineRange(BODY, blocks[1])).toEqual({ from: 3, to: 3 });
  });

  it("複数行のブロックは、終わりの行まで出す", () => {
    expect(lineRange(BODY, blocks[2])).toEqual({ from: 5, to: 6 });
  });

  it("末尾のブロックでも、後ろの空行を数え込まない", () => {
    expect(lineRange(BODY, blocks[3])).toEqual({ from: 8, to: 8 });
  });

  it("フロントマターのぶんだけずらせる", () => {
    // ---\ntitle: 題\n---\n は 3 行。
    expect(lineRange(BODY, blocks[1], 3)).toEqual({ from: 6, to: 6 });
  });
});

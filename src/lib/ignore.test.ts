import { describe, expect, it } from "vitest";
import { ignoreLines } from "./ignore";

// 設定画面の「N 件で外しています」のための数え方。当てるのは Rust 側なので、
// ここで見るのは「どの行が効くか」だけ。

describe("効いている行", () => {
  it("空行と覚書は数えない", () => {
    expect(ignoreLines("\n\n  \n# これは覚書\nnode_modules/\n")).toEqual([
      "node_modules/",
    ]);
  });

  it("# が行の途中にあるだけなら、そのまま 1 行", () => {
    expect(ignoreLines("メモ#1.md")).toEqual(["メモ#1.md"]);
  });

  it("行末の空白は落とす", () => {
    expect(ignoreLines("*.lock   ")).toEqual(["*.lock"]);
  });

  it("逃がした空白は残す（名前の末尾が空白のファイルに当てられる）", () => {
    expect(ignoreLines("後ろが空白\\ ")).toEqual(["後ろが空白\\ "]);
  });

  it("否定も 1 件として数える", () => {
    expect(ignoreLines("*.md\n!残す.md")).toHaveLength(2);
  });
});

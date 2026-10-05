import { describe, expect, it } from "vitest";
import { addToBar, barTarget, moveInBar, removeFromBar, visit } from "./workspaceBar";

describe("ワークスペースの列", () => {
  it("開いたら末尾に入り、既にあれば動かさない", () => {
    expect(addToBar(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(addToBar(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("外す", () => {
    expect(removeFromBar(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("差し込み位置へ動かす（前へも後ろへも）", () => {
    expect(moveInBar(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveInBar(["a", "b", "c"], "a", 3)).toEqual(["b", "c", "a"]);
    expect(moveInBar(["a", "b", "c"], "a", 2)).toEqual(["b", "a", "c"]);
    expect(moveInBar(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
  });

  it("⌃1〜8 は位置、⌃9 は最後", () => {
    expect(barTarget(["a", "b", "c"], 2)).toBe("b");
    expect(barTarget(["a", "b", "c"], 5)).toBeUndefined();
    expect(barTarget(["a", "b", "c"], 9)).toBe("c");
  });

  it("開いた順は新しいものを先頭に", () => {
    expect(visit(["a", "b"], "b")).toEqual(["b", "a"]);
  });
});

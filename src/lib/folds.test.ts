import { afterEach, describe, expect, it } from "vitest";
import { foldKey, forgetFolds, recallFold, rememberFold } from "./folds";

// トグルの開閉の控え。ファイルごとに分け、押していないものは原文のタグに従う。

afterEach(() => {
  forgetFolds();
});

describe("トグルの開閉", () => {
  it("押していないものは渡した初期値のまま", () => {
    expect(recallFold(foldKey("/a.md", "題"), false)).toBe(false);
    expect(recallFold(foldKey("/a.md", "題"), true)).toBe(true);
  });

  it("押した通りに覚える。閉じた控えも初期値より優先する", () => {
    rememberFold(foldKey("/a.md", "題"), true);
    expect(recallFold(foldKey("/a.md", "題"), false)).toBe(true);
    rememberFold(foldKey("/a.md", "題"), false);
    expect(recallFold(foldKey("/a.md", "題"), true)).toBe(false);
  });

  it("ファイルが違えば別の控え", () => {
    rememberFold(foldKey("/a.md", "題"), true);
    expect(recallFold(foldKey("/b.md", "題"), false)).toBe(false);
  });

  it("題の前後の空白は無視する（2 面で同じ鍵になる）", () => {
    rememberFold(foldKey("/a.md", " 題 "), true);
    expect(recallFold(foldKey("/a.md", "題"), false)).toBe(true);
  });

  it("ファイルが分からないうちは覚えない", () => {
    rememberFold(foldKey(null, "題"), true);
    expect(recallFold(foldKey(null, "題"), false)).toBe(false);
  });
});

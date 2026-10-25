// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { scrolledAround } from "./scrolledAround";

// 書く面の帯は、本文を送ったときだけ測り直す。リンクの入力欄の中の横送りで
// 測り直すと、選択が入力欄にあるので帯ごと閉じる。

describe("scrolledAround", () => {
  const box = document.createElement("div");
  const editor = document.createElement("div");
  box.appendChild(editor);
  const input = document.createElement("input");
  document.body.append(box, input);

  it("本文を包む箱のスクロールは数える", () => {
    expect(scrolledAround(box, editor)).toBe(true);
  });

  it("本文を含まない要素（入力欄など）のスクロールは数えない", () => {
    expect(scrolledAround(input, editor)).toBe(false);
  });

  it("文書全体のスクロールは数える", () => {
    expect(scrolledAround(document, editor)).toBe(true);
    expect(scrolledAround(window, editor)).toBe(true);
  });
});

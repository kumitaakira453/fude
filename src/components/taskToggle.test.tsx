// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { toggleTaskAt, toggleTaskNth } from "../lib/blocks";
import { Markdown } from "./Markdown";

// 読むときのタスクの入れ替えを、実際に描いた DOM で確かめる。
//
// 描画側が項目に載せる位置と、原文の行を書き換える手が噛み合っているかは、
// 片方だけ見ても分からない。描いたチェックを順に辿り、そこから原文がどう
// 変わるかまで見る。

let root: Root | null = null;
let host: HTMLElement | null = null;

// react-dom は環境にこの印を求める。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(body: string): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<Markdown body={body} editorial onToggleTask={() => {}} />);
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

// 描かれたチェックの、項目に載っている原文の位置。
const anchors = (at: HTMLElement): number[] =>
  [...at.querySelectorAll(".mg-task-check")].map((check) =>
    Number(check.closest<HTMLElement>("[data-mg-item]")?.dataset.mgItem),
  );

describe("読むときのタスクの入れ替え", () => {
  it("素の一覧で、押したチェックの行が入れ替わる", () => {
    const body = ["- [ ] あ", "- [ ] い", "- [ ] う"].join("\n");
    const at = render(body);
    const found = anchors(at);
    expect(found).toHaveLength(3);

    expect(toggleTaskAt(body, found[1])).toBe(
      ["- [ ] あ", "- [x] い", "- [ ] う"].join("\n"),
    );
    expect(toggleTaskAt(body, found[2])).toBe(
      ["- [ ] あ", "- [ ] い", "- [x] う"].join("\n"),
    );
  });

  it("コード例の中の \"- [ ] \" があってもずれない", () => {
    const body = [
      "- [ ] さきに書くもの",
      "",
      "  ```",
      "  - [ ] コード例なのでチェックにならない",
      "  ```",
      "",
      "- [ ] あとに書くもの",
    ].join("\n");
    const at = render(body);
    const found = anchors(at);
    // コード例の行はチェックにならない。描かれるのは 2 つだけ。
    expect(found).toHaveLength(2);

    expect(toggleTaskAt(body, found[1])).toBe(
      [
        "- [ ] さきに書くもの",
        "",
        "  ```",
        "  - [ ] コード例なのでチェックにならない",
        "  ```",
        "",
        "- [x] あとに書くもの",
      ].join("\n"),
    );
    // 同じ 2 つ目を上から数えると、コード例の行に当たってしまう。
    expect(toggleTaskNth(body, 1)).toContain("  - [x] コード例");
  });

  it("番号付きのタスクでもずれない", () => {
    const body = ["1. [ ] あ", "2. [ ] い"].join("\n");
    const at = render(body);
    const found = anchors(at);
    expect(found).toHaveLength(2);
    expect(toggleTaskAt(body, found[1])).toBe(
      ["1. [ ] あ", "2. [x] い"].join("\n"),
    );
  });
});

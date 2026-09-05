import { describe, expect, it } from "vitest";
import { toggleTaskAt, toggleTaskNth } from "./blocks";

// タスクの印の入れ替え。描画側は項目に原文の位置を載せているので、
// 書き換える行はその位置から決める。

// n 番目の項目の位置。描画側が載せる目印（mdast の listItem の開始位置＝
// 字下げを除いた記号の位置）と同じ数え方をする。GFM と同じく、"]" の後ろに
// 空白がある行だけをタスクと見る。
function anchorOf(src: string, nth: number): number {
  const lines = src.split("\n");
  let at = 0;
  let seen = -1;
  for (const line of lines) {
    const head = /^(\s*)(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s/.exec(line);
    if (head && ++seen === nth) return at + head[1].length;
    at += line.length + 1;
  }
  throw new Error("その項目が無い");
}

describe("toggleTaskAt", () => {
  const src = ["- [ ] あ", "- [ ] い", "- [x] う"].join("\n");

  it("押した項目の行だけが入れ替わる", () => {
    expect(toggleTaskAt(src, anchorOf(src, 0))).toBe(
      ["- [x] あ", "- [ ] い", "- [x] う"].join("\n"),
    );
    expect(toggleTaskAt(src, anchorOf(src, 1))).toBe(
      ["- [ ] あ", "- [x] い", "- [x] う"].join("\n"),
    );
    expect(toggleTaskAt(src, anchorOf(src, 2))).toBe(
      ["- [ ] あ", "- [ ] い", "- [ ] う"].join("\n"),
    );
  });

  it("行のどこを指してもその行が入れ替わる", () => {
    const at = src.indexOf("い");
    expect(toggleTaskAt(src, at)).toBe(
      ["- [ ] あ", "- [x] い", "- [x] う"].join("\n"),
    );
  });

  it("タスクでない行を指したら何もしない", () => {
    const other = ["ふつうの段落", "- ふつうの項目"].join("\n");
    expect(toggleTaskAt(other, 0)).toBeNull();
    expect(toggleTaskAt(other, other.indexOf("ふつうの項目"))).toBeNull();
  });

  it("番号付きのタスクでも入れ替わる", () => {
    const ordered = ["1. [ ] あ", "2. [x] い", "3) [ ] う"].join("\n");
    expect(toggleTaskAt(ordered, anchorOf(ordered, 1))).toBe(
      ["1. [ ] あ", "2. [ ] い", "3) [ ] う"].join("\n"),
    );
    expect(toggleTaskAt(ordered, anchorOf(ordered, 2))).toBe(
      ["1. [ ] あ", "2. [x] い", "3) [x] う"].join("\n"),
    );
  });

  it("入れ子の項目でも、押したほうの行が入れ替わる", () => {
    const nested = ["- [ ] おや", "  - [ ] こ", "- [ ] つぎ"].join("\n");
    expect(toggleTaskAt(nested, anchorOf(nested, 1))).toBe(
      ["- [ ] おや", "  - [x] こ", "- [ ] つぎ"].join("\n"),
    );
  });

  // 報告の「一つ下が反応する」はこの形。GFM がタスクとして描かない行を
  // 数え上げが 1 つ数えてしまい、以降がまとめてずれる。
  it("コード例の中の \"- [ ] \" があってもずれない", () => {
    const withCode = [
      "- [ ] さきに書くもの",
      "",
      "  ```",
      "  - [ ] コード例なのでチェックにならない",
      "  ```",
      "",
      "- [ ] あとに書くもの",
    ].join("\n");

    // 2 番目に描かれるチェックは最後の行。位置で決めれば当たる。
    expect(toggleTaskAt(withCode, withCode.indexOf("- [ ] あとに書くもの"))).toBe(
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

    // 上から数えると、コード例の行を数えたぶんだけ 1 つ手前に当たる。
    expect(toggleTaskNth(withCode, 1)).toBe(
      [
        "- [ ] さきに書くもの",
        "",
        "  ```",
        "  - [x] コード例なのでチェックにならない",
        "  ```",
        "",
        "- [ ] あとに書くもの",
      ].join("\n"),
    );
  });

  it("\"]\" の後ろに空白が無い行でもずれない", () => {
    // GFM は "- [ ]あ" をタスクとして描かない。数え上げはこれを数える。
    const typo = ["- [ ]あ", "- [ ] い"].join("\n");
    expect(toggleTaskAt(typo, anchorOf(typo, 0))).toBe(
      ["- [ ]あ", "- [x] い"].join("\n"),
    );
    expect(toggleTaskNth(typo, 0)).toBe(["- [x]あ", "- [ ] い"].join("\n"));
  });
});

describe("toggleTaskNth", () => {
  it("上から数えて入れ替える", () => {
    const src = ["- [ ] あ", "- [ ] い"].join("\n");
    expect(toggleTaskNth(src, 1)).toBe(["- [ ] あ", "- [x] い"].join("\n"));
  });

  it("その番号が無ければ何もしない", () => {
    expect(toggleTaskNth("- [ ] あ", 3)).toBeNull();
    expect(toggleTaskNth("ふつうの段落", 0)).toBeNull();
  });
});

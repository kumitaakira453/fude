import { describe, expect, it } from "vitest";
import { continueList, linkAt, wrapWith } from "./mdInput";

// キャレットの位置を | で示した字から、値と位置を作る。
function at(marked: string): [string, number] {
  const i = marked.indexOf("|");
  return [marked.replace("|", ""), i];
}

// 返ってきた値とキャレットを、同じ書き方に戻して見比べる。
function show(edit: { value: string; start: number; end: number } | null): string {
  if (!edit) return "そのまま";
  const { value, start, end } = edit;
  return start === end
    ? `${value.slice(0, start)}|${value.slice(start)}`
    : `${value.slice(0, start)}[${value.slice(start, end)}]${value.slice(end)}`;
}

describe("改行の続き", () => {
  it("箇条書きを引き継ぐ", () => {
    expect(show(continueList(...at("- あ|")))).toBe("- あ\n- |");
    expect(show(continueList(...at("* あ|")))).toBe("* あ\n* |");
    expect(show(continueList(...at("  - あ|")))).toBe("  - あ\n  - |");
  });

  it("番号は 1 つ進める", () => {
    expect(show(continueList(...at("3. あ|")))).toBe("3. あ\n4. |");
    expect(show(continueList(...at("1) あ|")))).toBe("1) あ\n2) |");
  });

  it("チェックは外した状態で引き継ぐ", () => {
    expect(show(continueList(...at("- [x] あ|")))).toBe("- [x] あ\n- [ ] |");
    expect(show(continueList(...at("- [ ] あ|")))).toBe("- [ ] あ\n- [ ] |");
  });

  it("引用を引き継ぐ", () => {
    expect(show(continueList(...at("> あ|")))).toBe("> あ\n> |");
  });

  it("記号だけの行では記号を落とす", () => {
    expect(show(continueList(...at("- あ\n- |")))).toBe("- あ\n|");
    expect(show(continueList(...at("- [ ] |")))).toBe("|");
    expect(show(continueList(...at("> |")))).toBe("|");
  });

  it("引き継ぐものが無ければ素の改行に任せる", () => {
    expect(continueList(...at("ふつうの行|"))).toBeNull();
    expect(continueList(...at("あ\nい|"))).toBeNull();
  });

  it("行の途中でも、その行の記号を見る", () => {
    expect(show(continueList(...at("- あ|い")))).toBe("- あ\n- |い");
  });
});

describe("囲み", () => {
  it("選んだところを囲む", () => {
    const [v] = at("あいう");
    expect(show(wrapWith(v, 1, 2, "**"))).toBe("あ**[い]**う");
  });

  it("囲まれていれば外す", () => {
    const [v] = at("あ**い**う");
    expect(show(wrapWith(v, 3, 4, "**"))).toBe("あ[い]う");
  });

  it("記号ごと選んでいても外す", () => {
    const [v] = at("あ**い**う");
    expect(show(wrapWith(v, 1, 6, "**"))).toBe("あ[い]う");
  });

  it("選んでいなければ記号の間へ送る", () => {
    expect(show(wrapWith(...at("あ|"), 1, "*"))).toBe("あ*|*");
  });
});

describe("リンク", () => {
  it("選んだ言葉を見出しにして、行き先を選ぶ", () => {
    const [v] = at("これは fude です");
    expect(show(linkAt(v, 4, 8))).toBe("これは [fude]([url]) です");
  });

  it("URL を選んでいたら見出しの側へ送る", () => {
    const [v] = at("https://example.com");
    expect(show(linkAt(v, 0, v.length))).toBe("[|](https://example.com)");
  });

  it("選んでいなければ空の見出しを置く", () => {
    expect(show(linkAt(...at("|"), 0))).toBe("[]([url])");
  });
});

import { EditorState } from "prosemirror-state";
import type { DecorationSet } from "prosemirror-view";
import { describe, expect, it } from "vitest";
import { MERMAID, PLAIN, highlightCode, languages, tokens } from "./highlight";
import { fromMarkdown } from "./fromMarkdown";

// 色の付く範囲を、元の文字列のどこかで確かめる。クラス名は読むときと同じ
// hljs-* で、色そのものは index.css が持っている。
const slice = (code: string, lang: string) =>
  tokens(code, lang).map((t) => ({ text: code.slice(t.from, t.to), cls: t.cls }));

describe("色の付く範囲", () => {
  it("python の予約語と文字列を拾う", () => {
    const got = slice('def f(x):\n    return "a"', "python");
    expect(got).toContainEqual({ text: "def", cls: "hljs-keyword" });
    expect(got).toContainEqual({ text: "return", cls: "hljs-keyword" });
    expect(got.some((t) => t.text === '"a"' && t.cls === "hljs-string")).toBe(true);
  });

  it("入れ子の span はいちばん内側のクラスを採る", () => {
    const got = slice("def f(x):\n    pass", "python");
    // 関数名は hljs-title function_ の二枚重ね。読むときの CSS もこの形で当たる。
    expect(got).toContainEqual({ text: "f", cls: "hljs-title function_" });
  });

  it("別名でも引ける", () => {
    expect(slice("const a = 1", "ts").length).toBeGreaterThan(0);
    expect(slice("const a = 1", "tsx").length).toBeGreaterThan(0);
  });

  it("範囲が重ならず、順に並ぶ", () => {
    const got = tokens("def f(x):\n    return 1", "python");
    for (let i = 1; i < got.length; i++) {
      expect(got[i].from).toBeGreaterThanOrEqual(got[i - 1].to);
    }
  });

  it("言語なし・未登録・図には色を付けない", () => {
    expect(tokens("def f(): pass", null)).toEqual([]);
    expect(tokens("select 1", "jq")).toEqual([]);
    expect(tokens("graph LR\n  A --> B", MERMAID)).toEqual([]);
  });
});

describe("言語の候補", () => {
  it("指定なしと図を先に置く", () => {
    expect(languages(null).slice(0, 2)).toEqual([PLAIN, MERMAID]);
  });

  it("色を付けられる言語が入る", () => {
    expect(languages(null)).toContain("python");
    expect(languages(null)).toContain("typescript");
  });

  it("一覧に無い値でも、いま入っているものは捨てない", () => {
    expect(languages("jq")).toContain("jq");
    // 一覧にある値を二重に足さない
    expect(languages("python").filter((l) => l === "python")).toHaveLength(1);
  });
});

describe("装飾", () => {
  it("塊の中の正しい位置に付く", () => {
    const body = "```python\ndef f():\n    pass\n```\n";
    const loaded = fromMarkdown(body);
    const state = EditorState.create({ doc: loaded.doc, plugins: [highlightCode] });
    const found = (highlightCode.getState(state) as DecorationSet).find();
    expect(found.length).toBeGreaterThan(0);
    // 塊は doc の先頭。中の文字は 1 つ内側から始まる。
    const code = loaded.doc.child(0);
    const first = found[0];
    expect(code.textContent.slice(first.from - 1, first.to - 1)).toBe("def");
  });

  it("言語のない塊には付かない", () => {
    const loaded = fromMarkdown("```\nplain text\n```\n");
    const state = EditorState.create({ doc: loaded.doc, plugins: [highlightCode] });
    expect((highlightCode.getState(state) as DecorationSet).find()).toEqual([]);
  });
});

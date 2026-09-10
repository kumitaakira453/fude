import { describe, expect, it } from "vitest";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { remarkSoftBreaks } from "./softBreaks";

const processor = unified().use(remarkParse).use(remarkGfm);

interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

// 変換を通した木から、path で辿った先の子の型を並べる。
function kinds(src: string, path: number[] = [0]): string[] {
  let node = parse(src);
  for (const i of path) node = node.children![i];
  return (node.children ?? []).map((c) => c.type);
}

function parse(src: string): Node {
  const tree = processor.parse(src) as unknown as Node;
  remarkSoftBreaks()(tree as never);
  return tree;
}

describe("単独の改行", () => {
  it("改行として残る", () => {
    expect(kinds("あ\nい")).toEqual(["text", "break", "text"]);
  });

  it("空行は段落の切れ目のまま", () => {
    expect(parse("あ\n\nい").children!.map((c) => c.type)).toEqual([
      "paragraph",
      "paragraph",
    ]);
    expect(kinds("あ\n\nい")).toEqual(["text"]);
  });

  it("箇条書きの項目の中でも効く", () => {
    expect(kinds("- あ\n  い", [0, 0, 0])).toEqual(["text", "break", "text"]);
  });

  it("強調の中の改行も拾う", () => {
    expect(kinds("**あ\nい**")).toEqual(["strong"]);
    expect(kinds("**あ\nい**", [0, 0])).toEqual(["text", "break", "text"]);
  });

  it("コードブロックは変わらない", () => {
    expect(parse("```\nあ\nい\n```").children![0]).toMatchObject({
      type: "code",
      value: "あ\nい",
    });
  });

  it("行内のコードは変わらない", () => {
    expect(kinds("`あ`")).toEqual(["inlineCode"]);
    expect(parse("`あ`").children![0].children![0].value).toBe("あ");
  });
});

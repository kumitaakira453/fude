import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { toMarkdown } from "./toMarkdown";

// 本文の無い文書（フロントマターだけのもの）を開いて、何も書かずに書き戻す。
// 編集面は空の段落を 1 つ置くが、それで改行を足して原文を書き換えない。

const round = (body: string) => {
  const loaded = fromMarkdown(body);
  return toMarkdown(loaded.doc, loaded);
};

describe("本文の無い文書", () => {
  it("空の本文は空のまま", () => {
    expect(round("")).toBe("");
  });

  it("空行だけの本文も原文のまま", () => {
    expect(round("\n\n")).toBe("\n\n");
  });

  it("ブロックにならない注釈だけの本文も落とさない", () => {
    expect(round("[a]: https://example.com\n")).toBe("[a]: https://example.com\n");
  });

  it("書き足せば、その中身で書き出す", () => {
    const loaded = fromMarkdown("");
    const schema = loaded.doc.type.schema;
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("書いた")])]);
    expect(toMarkdown(doc, loaded)).toBe("書いた\n");
  });
});

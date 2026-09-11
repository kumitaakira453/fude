import type { Transaction } from "prosemirror-state";
import { EditorState } from "prosemirror-state";
import { afterEach, describe, expect, it } from "vitest";
import { rules, setNotionKeys } from "./inputRules";
import { schema } from "./schema";

// 規則そのものを呼ぶには、prosemirror-inputrules が内部に持っている 2 つが要る。
// 型には出ていないので、ここで補う。画面を作らずに打鍵を試せる代わり。
declare module "prosemirror-inputrules" {
  interface InputRule {
    match: RegExp;
    handler: (
      state: EditorState,
      match: RegExpMatchArray,
      start: number,
      end: number,
    ) => Transaction | null;
  }
}

// 打鍵を真似て、入力変換が効くかを確かめる。
//
// prosemirror-inputrules は「まだ入っていない 1 文字」を含めた文字列で規則を
// 見て、当たったら手前の分を書き換える。ここでも同じ数え方で呼ぶ。

// text を打ち終えた直後の doc を返す。最後の 1 文字が「いま打った文字」。
function type(text: string, into: "paragraph" | "cell" = "paragraph") {
  const typed = text.slice(-1);
  const before = text.slice(0, -1);
  const body = before === "" ? [] : [schema.text(before)];

  const doc =
    into === "paragraph"
      ? schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, body)])
      : schema.nodes.doc.create(null, [
          schema.nodes.table.create(null, [
            schema.nodes.tableRow.create(null, [
              schema.nodes.tableCell.create({ header: true }, body),
            ]),
          ]),
        ]);

  const state = EditorState.create({ doc });
  // 段落の中は 1、表は doc > table > tr > td と入って 3。
  const at = into === "paragraph" ? 1 + before.length : 3 + before.length;

  for (const rule of rules) {
    const match = rule.match.exec(text);
    if (!match) continue;
    const from = at - (match[0].length - typed.length);
    const tr = rule.handler(state, match, from, at);
    if (tr) return state.apply(tr).doc;
  }
  return doc;
}

const first = (text: string, into?: "paragraph" | "cell") => {
  const doc = type(text, into);
  return into === "cell" ? doc.child(0).child(0).child(0) : doc.child(0);
};

describe("ブロックを作る", () => {
  it("## で見出しになる", () => {
    const node = first("## ");
    expect(node.type.name).toBe("heading");
    expect(node.attrs.level).toBe(2);
  });

  it("- で箇条書きになり、打った記号を覚える", () => {
    const node = first("* ");
    expect(node.type.name).toBe("bulletList");
    expect(node.attrs.marker).toBe("*");
  });

  it("1. で番号付きになる", () => {
    const node = first("1. ");
    expect(node.type.name).toBe("orderedList");
    expect(node.attrs.marker).toBe(".");
  });

  it("> で引用になる", () => {
    expect(first("> ").type.name).toBe("blockquote");
  });

  it("``` で言語つきのコードになる", () => {
    const node = first("```ts ");
    expect(node.type.name).toBe("codeBlock");
    expect(node.attrs.lang).toBe("ts");
  });

  it("--- で水平線になり、打った形を覚える", () => {
    const node = first("---");
    expect(node.type.name).toBe("thematicBreak");
    expect(node.attrs.marker).toBe("---");
  });
});

describe("行内を装飾する", () => {
  it("`code` は囲みを消して code を付ける", () => {
    const node = first("`if`");
    expect(node.textContent).toBe("if");
    expect(node.child(0).marks.map((m) => m.type.name)).toEqual(["code"]);
  });

  it("**強い** は囲みを消して strong を付ける", () => {
    const node = first("**ここ**");
    expect(node.textContent).toBe("ここ");
    expect(node.child(0).marks.map((m) => m.type.name)).toEqual(["strong"]);
  });

  it("*斜め* は em を付ける", () => {
    const node = first("*ここ*");
    expect(node.textContent).toBe("ここ");
    expect(node.child(0).marks.map((m) => m.type.name)).toEqual(["em"]);
  });

  it("~~消し~~ は strike を付ける", () => {
    const node = first("~~ここ~~");
    expect(node.child(0).marks.map((m) => m.type.name)).toEqual(["strike"]);
  });

  it("[題](url) はリンクになる", () => {
    const node = first("[題](https://example.com)");
    expect(node.textContent).toBe("題");
    expect(node.child(0).marks[0].attrs.href).toBe("https://example.com");
  });

  it("前に字があっても効く", () => {
    const node = first("あ**ここ**");
    expect(node.textContent).toBe("あここ");
    expect(node.child(1).marks.map((m) => m.type.name)).toEqual(["strong"]);
  });

  it("表のセルの中でも効く", () => {
    const node = first("**ここ**", "cell");
    expect(node.textContent).toBe("ここ");
    expect(node.child(0).marks.map((m) => m.type.name)).toEqual(["strong"]);
  });
});


describe("Notion 風の打ち込み（試験中の設定）", () => {
  afterEach(() => setNotionKeys(false));

  it("入れていなければ、`>` は今までどおり引用", () => {
    expect(first("> ").type.name).toBe("blockquote");
  });

  it("入れていなければ、`|` では何も起きない", () => {
    expect(first("| ").type.name).toBe("paragraph");
  });

  it("入れると `>` はトグルになる", () => {
    setNotionKeys(true);
    const node = first("> ");
    expect(node.type.name).toBe("details");
    expect(node.attrs.head).toBe("<details>\n<summary>トグル</summary>");
  });

  it("入れると `|` が引用になる", () => {
    setNotionKeys(true);
    expect(first("| ").type.name).toBe("blockquote");
  });
});

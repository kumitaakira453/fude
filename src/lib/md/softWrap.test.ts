import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { toMarkdown } from "./toMarkdown";
import { schema } from "./schema";
import { Fragment, type Node as PmNode } from "prosemirror-model";

// 段落の途中の改行（折り返し）の扱い。
//
// Markdown では空白 1 つに潰れる。編集面は pre-wrap なので、\n を持ったままだと
// 原文に無い改行として描かれてしまう。取り込むときに空白へ替え、書き戻すときは
// 原文の折り返しをそのまま残す。

const round = (src: string) => {
  const loaded = fromMarkdown(src);
  return toMarkdown(loaded.doc, loaded);
};

// 本文の中の字を打ち替えた doc を作り、書き戻す。深さは問わない。
const swap = (node: PmNode, from: string, to: string): PmNode => {
  if (node.isText) {
    return node.text?.includes(from)
      ? schema.text(node.text.replace(from, to), node.marks)
      : node;
  }
  const kids: PmNode[] = [];
  node.forEach((kid) => kids.push(swap(kid, from, to)));
  return node.copy(Fragment.fromArray(kids));
};

const retype = (src: string, from: string, to: string) => {
  const loaded = fromMarkdown(src);
  return toMarkdown(swap(loaded.doc, from, to), loaded);
};

describe("取り込み", () => {
  it("段落の途中の改行は空白 1 つになる", () => {
    expect(fromMarkdown("あいう\nえお\n").doc.child(0).textContent).toBe("あいう えお");
  });

  it("行末に空白が 1 つ残っていても同じ", () => {
    expect(fromMarkdown("abc \ndef\n").doc.child(0).textContent).toBe("abc def");
  });

  it("箇条書きの中の、字下げされた折り返しでも同じ", () => {
    const doc = fromMarkdown("- あいう\n  えお\n").doc;
    expect(doc.textContent).toBe("あいう えお");
  });

  it("引用の中でも同じ", () => {
    expect(fromMarkdown("> あいう\n> えお\n").doc.textContent).toBe("あいう えお");
  });

  it("空白 2 つで終わる行は、今までどおり改行になる", () => {
    const p = fromMarkdown("あいう  \nえお\n").doc.child(0);
    expect(p.child(1).type).toBe(schema.nodes.hardBreak);
    expect(p.textContent).toBe("あいうえお");
  });

  it("\\ で終わる行も改行になる", () => {
    const p = fromMarkdown("あいう\\\nえお\n").doc.child(0);
    expect(p.child(1).type).toBe(schema.nodes.hardBreak);
  });

  it("コードの塊の中の改行はそのまま", () => {
    const doc = fromMarkdown("```\na\nb\n```\n").doc;
    expect(doc.child(0).textContent).toBe("a\nb");
  });
});

describe("書き戻し", () => {
  it("触らなければ原文のまま", () => {
    const src = "あいう\nえお\n\n- ひとつ\n  つづき\n";
    expect(round(src)).toBe(src);
  });

  it("段落の中の字を打ち替えても、折り返しは残る", () => {
    expect(retype("あいう\nえお\n", "あいう", "あいえ")).toBe("あいえ\nえお\n");
  });

  it("折り返しをまたいだ先を打ち替えても、折り返しは残る", () => {
    expect(retype("あいう\nえお\n", "えお", "えか")).toBe("あいう\nえか\n");
  });

  it("行末の空白も残る", () => {
    expect(retype("abc \ndef\n", "abc", "abX")).toBe("abX \ndef\n");
  });

  it("箇条書きの字下げも残る", () => {
    expect(retype("- あいう\n  えお\n", "あいう", "あいえ")).toBe("- あいえ\n  えお\n");
  });

  it("3 行にまたがっていても残る", () => {
    const src = "ひとつ\nふたつ\nみっつ\n";
    expect(retype(src, "ふたつ", "ふたX")).toBe("ひとつ\nふたX\nみっつ\n");
  });
});

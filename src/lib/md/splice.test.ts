import { Fragment, type Node as PmNode } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { toMarkdown } from "./toMarkdown";

// 原文の書き方を保ったまま差し込む。1 文字打ったときに動くのはその 1 文字だけ
// ——という決まりを、実体参照を含む書き方でも通す。
//
// 実体参照は原文では数文字、読むと 1 文字になる。ここを読み飛ばせないと塊ごと
// 組み直しになり、触っていない所まで書き換わる（行頭の `-` が `\-` になる等）。

// 先頭のブロックの、最初の字の後ろに 1 文字足して書き戻す。
function typeInFirst(src: string, ch: string): string {
  const loaded = fromMarkdown(src);
  const node = loaded.doc.child(0);
  const next = loaded.doc.copy(
    Fragment.fromArray([grow(node, ch) ?? node, ...rest(loaded.doc)]),
  );
  return toMarkdown(next, loaded);
}

function rest(doc: PmNode): PmNode[] {
  const out: PmNode[] = [];
  doc.forEach((node, _offset, index) => {
    if (index > 0) out.push(node);
  });
  return out;
}

// 最初に見つかった字の末尾へ足す。
function grow(node: PmNode, ch: string): PmNode | null {
  if (node.isText) return node.type.schema.text((node.text ?? "") + ch, node.marks);
  const children: PmNode[] = [];
  let done = false;
  node.forEach((child) => {
    if (done) {
      children.push(child);
      return;
    }
    const next = grow(child, ch);
    if (next) done = true;
    children.push(next ?? child);
  });
  return done ? node.copy(Fragment.fromArray(children)) : null;
}

describe("原文の書き方を保つ差し込み", () => {
  it("実体参照の空白はそのまま残す", () => {
    // 「- ＋ 実体参照の空白」。組み直すと行頭の - まで逃がされてしまう
    expect(typeInFirst("-&#x20;\n", "字")).toBe("-&#x20;字\n");
  });

  it("名前の実体参照もそのまま残す", () => {
    expect(typeInFirst("A&amp;B\n", "字")).toBe("A&amp;B字\n");
  });

  it("10 進の実体参照もそのまま残す", () => {
    expect(typeInFirst("A&#38;B\n", "字")).toBe("A&#38;B字\n");
  });

  it("読めない実体参照は、今までどおり組み直す", () => {
    // &zwnj; は読まない。原文のままにはならないが、意味は保つ
    const out = typeInFirst("A&zwnj;B\n", "字");
    expect(out).not.toContain("&zwnj;");
    expect(out).toContain("字");
  });

  it("実体参照の無い書き方は今までどおり", () => {
    expect(typeInFirst("ふつうの段落\n", "字")).toBe("ふつうの段落字\n");
  });
});

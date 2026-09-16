import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { toMarkdown } from "./toMarkdown";
import { schema } from "./schema";

// 絵だけの段落を塊として持つところ。
//
// 原文（CommonMark）では `![](x)` は段落の中の行内要素。編集モデルだけを塊に
// するので、読み書きで形が崩れないことが要になる。

const trip = (md: string) => {
  const loaded = fromMarkdown(md);
  return toMarkdown(loaded.doc, loaded);
};

const shape = (md: string) => {
  const out: string[] = [];
  fromMarkdown(md).doc.forEach((n) => out.push(n.type.name));
  return out;
};

describe("絵だけの段落", () => {
  it("塊として読む", () => {
    expect(shape("![](./a.png)\n")).toEqual(["imageBlock"]);
  });

  it("原文へそのまま戻る", () => {
    expect(trip("![](./a.png)\n")).toBe("![](./a.png)\n");
  });

  it("代替テキストも題も保つ", () => {
    const md = '![滞留の内訳](./a.png "題")\n';
    expect(trip(md)).toBe(md);
  });

  it("空白を含む道筋（山括弧）も保つ", () => {
    const md = "![](<./images/写 真.png>)\n";
    expect(trip(md)).toBe(md);
  });

  it("字と混ざっている段落は段落のまま", () => {
    expect(shape("k![](./a.png)\n")).toEqual(["paragraph"]);
    expect(trip("k![](./a.png)\n")).toBe("k![](./a.png)\n");
  });

  it("絵が 2 枚並ぶ段落も段落のまま", () => {
    expect(shape("![](./a.png)![](./b.png)\n")).toEqual(["paragraph"]);
  });

  it("前後の塊を巻き込まない", () => {
    const md = "# 題\n\n![](./a.png)\n\n本文\n";
    expect(shape(md)).toEqual(["heading", "imageBlock", "paragraph"]);
    expect(trip(md)).toBe(md);
  });

  it("引用や箇条書きの中でも塊として読む", () => {
    expect(trip("> ![](./a.png)\n")).toBe("> ![](./a.png)\n");
    expect(trip("- ![](./a.png)\n")).toBe("- ![](./a.png)\n");
  });

  it("行内の絵は今までどおり行内の節点", () => {
    const doc = fromMarkdown("k![](./a.png)\n").doc;
    expect(doc.firstChild?.lastChild?.type).toBe(schema.nodes.image);
  });
});

import type { Node as PmNode } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { toMarkdown, blockText } from "./toMarkdown";
import { schema } from "./schema";

const round = (src: string) => {
  const loaded = fromMarkdown(src);
  return toMarkdown(loaded.doc, loaded);
};

// 先頭のブロックだけ中身を書き換えた doc を作る。id は同じままなので、
// 未編集の判定は内容の突き合わせで落ちる。
const editFirst = (src: string, text: string) => {
  const loaded = fromMarkdown(src);
  const children: PmNode[] = [];
  loaded.doc.forEach((node, _offset, index) => {
    children.push(index === 0 ? node.type.create(node.attrs, schema.text(text)) : node);
  });
  return toMarkdown(schema.nodes.doc.create(null, children), loaded);
};

describe("無編集なら原文がそのまま返る", () => {
  const cases: [string, string][] = [
    ["段落と見出し", "# 見出し\n\n本文です。\n"],
    ["空行が 2 つ", "段落A\n\n\n段落B\n"],
    ["末尾の改行なし", "# 見出し\n\n本文"],
    ["先頭の空行", "\n\n本文\n"],
    ["桁を揃えた表", "| key    | value  |\n|--------|--------|\n| a      | b      |\n"],
    ["素の表", "| a | b |\n| --- | --- |\n| c | d |\n"],
    ["箇条書き", "- 一つめ\n- 二つめ\n  - 入れ子\n"],
    ["タスク", "- [ ] やる\n- [x] やった\n"],
    ["引用", "> 引用の中\n> - 項目\n"],
    ["コード", "```ts\nconst a = 1;\n```\n"],
    ["字下げコード", "    const a = 1;\n"],
    ["水平線", "***\n\n本文\n"],
    ["生 HTML", "<div class=\"x\">\n中身\n</div>\n"],
    ["callout", '<callout icon="✅" color="gray_bg">\n中身の**強調**\n</callout>\n'],
    ["details", "<details>\n<summary>見出し</summary>\n中身\n</details>\n"],
    [
      "入れ子の details",
      "<details>\n<summary>\n外\n</summary>\n\n<details>\n<summary>内</summary>\n中身\n</details>\n\n</details>\n",
    ],
    ["語中の下線", "`content_scripts` と auto_creation.py の話\n"],
    ["行内 HTML", "これは <u> **下線** </u> です\n"],
  ];
  for (const [name, src] of cases) {
    it(name, () => expect(round(src)).toBe(src));
  }
});

describe("構造を読み取る", () => {
  it("callout は属性と中身を持つ", () => {
    const { doc } = fromMarkdown('<callout icon="✅" color="blue_bg">\n本文\n</callout>\n');
    const node = doc.child(0);
    expect(node.type.name).toBe("callout");
    expect(node.attrs.icon).toBe("✅");
    expect(node.attrs.color).toBe("blue_bg");
    expect(node.child(0).textContent).toBe("本文");
  });

  it("details は開きから </summary> までを原文のまま持つ", () => {
    const node = fromMarkdown("<details>\n<summary>題</summary>\n本文\n</details>\n").doc.child(0);
    expect(node.type.name).toBe("details");
    expect(node.attrs.head).toBe("<details>\n<summary>題</summary>");
    expect(node.child(0).textContent).toBe("本文");
  });

  it("summary が複数行でも入れ子でも壊れない", () => {
    const src = "<details>\n<summary>\n外\n</summary>\n\n<details>\n<summary>内</summary>\n中身\n</details>\n\n</details>\n";
    const node = fromMarkdown(src).doc.child(0);
    expect(node.type.name).toBe("details");
    expect(node.attrs.head).toBe("<details>\n<summary>\n外\n</summary>");
    expect(node.child(0).type.name).toBe("details");
  });

  it("桁が揃った表は幅を覚える", () => {
    const src = "| key    | value  |\n|--------|--------|\n| a      | b      |";
    const table = fromMarkdown(src).doc.child(0);
    expect(table.type.name).toBe("table");
    expect(table.attrs.widths).toEqual([8, 8]);
    expect(table.attrs.delim).toBe("|--------|--------|");
  });

  it("揃っていない表は詰めない", () => {
    const table = fromMarkdown("| a | b |\n| --- | --- |\n| c | dd |").doc.child(0);
    expect(table.attrs.widths).toEqual([0, 0]);
  });

  it("構造化しない HTML は原文のまま持つ", () => {
    const src = "<form>\n<input>\n</form>";
    const { doc } = fromMarkdown(src);
    expect(doc.child(0).type.name).toBe("rawBlock");
    expect(doc.child(0).attrs.value).toBe(src);
  });
});

describe("書き戻し", () => {
  it("触ったブロックだけが変わる", () => {
    const src = "# 見出し\n\n本文A\n\n本文B\n";
    const out = editFirst(src, "書き換えた見出し");
    expect(out).toBe("# 書き換えた見出し\n\n本文A\n\n本文B\n");
  });

  it("揃った表は桁を保ったまま組み直す", () => {
    const src = "| key    | value  |\n|--------|--------|\n| a      | b      |";
    expect(blockText(fromMarkdown(src).doc.child(0))).toBe(src);
  });

  it("素の表はそのまま組み直す", () => {
    const src = "| a | b |\n| --- | --- |\n| c | d |";
    expect(blockText(fromMarkdown(src).doc.child(0))).toBe(src);
  });

  it("要らないエスケープを外す", () => {
    const { doc } = fromMarkdown("auto_creation.py と bulk_create の話");
    expect(blockText(doc.child(0))).toBe("auto_creation.py と bulk_create の話");
  });

  it("意味が変わるエスケープは残す", () => {
    // 行頭の "- " は箇条書きになってしまうので、逃がしたままにする。
    const { doc } = fromMarkdown("\\- これは段落");
    expect(blockText(doc.child(0))).toBe("\\- これは段落");
  });
});

import { Fragment, type Node as PmNode } from "prosemirror-model";
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

describe("数式", () => {
  it("打ち直すと $$ で囲み直す", () => {
    const loaded = fromMarkdown("$$\na^2\n$$\n");
    const was = loaded.doc.child(0);
    expect(was.type.name).toBe("mathBlock");
    const next = loaded.doc.copy(
      Fragment.fromArray([was.type.create({ ...was.attrs, tex: "b^2", raw: null })]),
    );
    expect(toMarkdown(next, loaded)).toBe("$$\nb^2\n$$\n");
  });

  it("中身が空になったら書き出さない", () => {
    const loaded = fromMarkdown("$$\na^2\n$$\n");
    const was = loaded.doc.child(0);
    const next = loaded.doc.copy(
      Fragment.fromArray([was.type.create({ ...was.attrs, tex: "", raw: null })]),
    );
    expect(toMarkdown(next, loaded)).toBe("\n");
  });
});

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
    ["行内の数式", "文中の $a^2 + b^2$ と続く\n"],
    ["独立した数式", "$$\n\\int_0^1 x\\,dx\n$$\n"],
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

// 最初の文字列に文字を足した写しを返す。実際の打鍵に一番近い操作。
const typeInto = (node: PmNode, add: string): PmNode | null => {
  if (node.isText) return node.type.schema.text((node.text ?? "") + add, node.marks);
  const children: PmNode[] = [];
  let done = false;
  node.forEach((child) => {
    const next = done ? null : typeInto(child, add);
    if (next) done = true;
    children.push(next ?? child);
  });
  return done ? node.copy(Fragment.fromArray(children)) : null;
};

const typeFirst = (src: string, add: string) => {
  const loaded = fromMarkdown(src);
  const children: PmNode[] = [];
  loaded.doc.forEach((node, _offset, index) => {
    const typed = index === 0 ? typeInto(node, add) : null;
    children.push(typed ?? node);
  });
  return toMarkdown(loaded.doc.copy(Fragment.fromArray(children)), loaded);
};

describe("1 文字打っても他は動かない", () => {
  const cases: [string, string][] = [
    ["桁を詰めた表", "| ケース     | 選ぶ方 |\n| --------- | ---- |\n| A         | B    |\n"],
    ["引用の中", "> 引用の中身\n> つづき\n"],
    ["字下げのコード", "\tひとつめ\n\tふたつめ\n"],
    ["逃がしのある段落", "auto_creation.py の話\n"],
    ["行の続き", "- 項目のつづきが\n字下げなしで書かれている\n"],
    ["行末の空白", "行末に空白がある  \nつづき\n"],
  ];
  for (const [name, src] of cases) {
    it(name, () => {
      const out = typeFirst(src, "Ω");
      expect(out.replace("Ω", "")).toBe(src);
      expect(out).toContain("Ω");
    });
  }

  it("行内コードの中は囲みを残したまま書き換わる", () => {
    const out = typeFirst("`content_scripts` の話\n", "Ω");
    expect(out).toBe("`content_scriptsΩ` の話\n");
  });

  it("記号を打っても壊れない", () => {
    // "*" は読み直すと意味が変わりうるので、確かめてから採用する。
    const out = typeFirst("ふつうの段落\n", "*");
    expect(fromMarkdown(out).doc.child(0).textContent).toBe("ふつうの段落*");
  });
});

describe("項目の中の囲み", () => {
  const para = (text: string) => schema.nodes.paragraph.create(null, [schema.text(text)]);
  const callout = () => schema.nodes.callout.create({ icon: "💡" }, [para("中の文")]);
  const list = (items: PmNode[][]) =>
    schema.nodes.bulletList.create(
      { tight: true },
      items.map((kids) => schema.nodes.listItem.create({ checked: null }, kids)),
    );
  const wrote = (...blocks: PmNode[]) =>
    toMarkdown(schema.nodes.doc.create(null, blocks), fromMarkdown(""));

  const IN_ITEM = wrote(list([[para("項目のあたま"), callout()], [para("つぎの項目")]]));

  // callout は Markdown に無いタグなので、開きの前に空行が無いと読み直しで
  // 段落に溶けてタグが字になる。
  it("開きタグの前に空行を入れて書き出す", () => {
    expect(IN_ITEM).toBe(
      '- 項目のあたま\n\n  <callout icon="💡">\n  中の文\n  </callout>\n- つぎの項目\n',
    );
  });

  it("読み直しても項目の中の囲みのまま", () => {
    const item = fromMarkdown(IN_ITEM).doc.child(0).child(0);
    expect(item.child(1).type.name).toBe("callout");
    expect(item.child(1).textContent).toBe("中の文");
  });

  it("読み書きしても動かない", () => {
    expect(round(IN_ITEM)).toBe(IN_ITEM);
  });

  it("項目の先頭に置いた囲みは印の直後に書く", () => {
    expect(wrote(list([[callout()]]))).toBe('- <callout icon="💡">\n  中の文\n  </callout>\n');
  });

  // 字下げ 4 以上をそのまま読み直すと、中身が字下げのコードになる。
  it("入れ子の項目の中でも、中身は段落のまま", () => {
    const nested = wrote(list([[para("親"), list([[para("子"), callout()]])]]));
    const inner = fromMarkdown(nested).doc.child(0).child(0).child(1).child(0).child(1);
    expect(inner.type.name).toBe("callout");
    expect(inner.child(0).type.name).toBe("paragraph");
    expect(inner.child(0).textContent).toBe("中の文");
  });

  it("中身の位置は原文のその字を指す", () => {
    const loaded = fromMarkdown(IN_ITEM);
    const item = loaded.spans.get("b0")!.children[0];
    const inside = item.children[1].children[0];
    expect(loaded.source.slice(inside.start, inside.end)).toBe("中の文");
  });

  it("最上位の囲みは字下げのコードを字下げのコードとして読む", () => {
    const top = fromMarkdown("<callout>\n    code だけ\n</callout>\n").doc.child(0);
    expect(top.child(0).type.name).toBe("codeBlock");
  });
});

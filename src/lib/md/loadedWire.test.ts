import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { pack, unpack } from "./loadedWire";
import { toMarkdown } from "./toMarkdown";

// 解析を Worker へ出すために、読み込んだ結果を素の値へ詰め替えて戻す。
//
// ここが崩れると**保存が壊れる**。`toMarkdown` はブロックごとの原文の範囲
// （ranges / spans）と読み込み時の節点（originals）を見て、触っていない
// ブロックを原文のまま返している。詰め替えで 1 つでも違えば、無編集で開いて
// 保存しただけでファイルが書き換わる。

// 手強いものを並べる。表・囲み・生 HTML・数式・脚注・参照リンク・入れ子。
const 題材: [string, string][] = [
  ["段落と装飾", "ふつうの段落に **強い** 字と `コード` と [リンク](https://example.com)。\n"],
  ["見出しと引用", "# みだし\n\n## 節\n\n> 引用の中の文\n>\n> - 項目\n"],
  [
    "表",
    "| 列 A | 列 B |\n| --- | ---: |\n| あ | 1 |\n| い | 2 |\n",
  ],
  [
    "コードの塊",
    "```python\ndef f(x):\n    return x + 1\n```\n\n```\n言語なし\n```\n",
  ],
  [
    "囲み",
    '<callout icon="⚠️" color="gray_bg">\n\n気をつけること\n\n</callout>\n',
  ],
  ["生 HTML", "<div align=\"center\">\n  <b>そのまま</b>\n</div>\n"],
  ["数式", "文中の $a^2 + b^2$ と、独立した式。\n\n$$\n\\int_0^1 x\\,dx\n$$\n"],
  ["脚注", "本文[^1]。\n\n[^1]: 注の中身\n"],
  ["参照リンク", "[あれ][ref] を見る。\n\n[ref]: https://example.com \"題\"\n"],
  [
    "入れ子の箇条書きと確認欄",
    "- 親\n  - 子\n    - 孫\n- [ ] やること\n- [x] 済み\n",
  ],
  ["水平線と改行", "上\n\n---\n\n下に  \n行内改行\n"],
  ["空", ""],
];

describe("読み込んだ結果の詰め替え", () => {
  for (const [名, body] of 題材) {
    it(`${名} は詰め替えても同じ`, () => {
      const was = fromMarkdown(body);
      const back = unpack(pack(was));

      expect(back.source).toBe(was.source);
      expect(back.doc.toJSON()).toEqual(was.doc.toJSON());
      expect([...back.ranges]).toEqual([...was.ranges]);
      expect([...back.spans]).toEqual([...was.spans]);
      // 読み込み時の節点は doc の子から引き直す。同じ id で同じ中身になる。
      expect([...back.originals.keys()]).toEqual([...was.originals.keys()]);
      for (const [id, node] of was.originals) {
        expect(back.originals.get(id)?.toJSON()).toEqual(node.toJSON());
      }
    });

    it(`${名} は詰め替えても保存の結果が変わらない`, () => {
      const was = fromMarkdown(body);
      const back = unpack(pack(was));
      // 比べるのは詰め替えの前後。toMarkdown が原文に戻すこと自体は
      // corpus.test.ts が実データで見ている。
      expect(toMarkdown(back.doc, back)).toBe(toMarkdown(was.doc, was));
    });
  }
});

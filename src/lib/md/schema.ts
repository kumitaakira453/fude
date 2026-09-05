import { Schema } from "prosemirror-model";

// 全文編集の編集モデル。Markdown の実データが要求する形だけを持つ。
//
// ノードの顔ぶれは monorepo-docs の 1072 ファイルを数えて決めた。数式と脚注は
// 実質使われていないので入れず、未知のものは原文のまま温存する（rawBlock /
// rawInline）。失うより、触れないほうがいい。
//
// トップレベルのブロックは id を持つ。読み込み時に振り、保存時に「読み込んだ
// ときと同じ内容か」を突き合わせるのに使う。同じなら直列化せず原文をそのまま
// 出すので、触っていない場所は 1 バイトも動かない。

const id = { id: { default: null as string | null } };

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },

    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { ...id },
    },

    heading: {
      group: "block",
      content: "inline*",
      attrs: { ...id, level: { default: 1 } },
    },

    blockquote: {
      group: "block",
      content: "block+",
      attrs: { ...id },
    },

    // fenced か字下げか、囲みが ``` か ~~~ かまで覚える。書き戻すときに
    // 元の書き方へ戻すため。
    codeBlock: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      attrs: {
        ...id,
        lang: { default: null as string | null },
        fenced: { default: true },
        fence: { default: "```" },
      },
    },

    bulletList: {
      group: "block",
      content: "listItem+",
      attrs: { ...id, tight: { default: true }, marker: { default: "-" } },
    },

    orderedList: {
      group: "block",
      content: "listItem+",
      attrs: {
        ...id,
        tight: { default: true },
        start: { default: 1 },
        marker: { default: "." },
      },
    },

    // checked が null なら普通の項目、true / false ならタスク。
    listItem: {
      content: "block+",
      attrs: { checked: { default: null as boolean | null } },
    },

    // widths は原文の桁幅。編集したセルの列だけが広がり、他は動かない。
    table: {
      group: "block",
      content: "tableRow+",
      attrs: {
        ...id,
        align: { default: [] as (string | null)[] },
        widths: { default: [] as number[] },
        delim: { default: null as string | null },
      },
    },

    tableRow: { content: "tableCell+" },

    tableCell: { content: "inline*", attrs: { header: { default: false } } },

    thematicBreak: {
      group: "block",
      attrs: { ...id, marker: { default: "---" } },
    },

    // Notion 由来の囲み。中身は普通のブロックとして編集できる。
    callout: {
      group: "block",
      content: "block+",
      attrs: {
        ...id,
        icon: { default: "" },
        color: { default: null as string | null },
      },
    },

    // 開きタグから </summary> までは原文のまま持つ。実データの summary は
    // 複数行に割れていたり入れ子になっていたりで、組み直すと崩れる。
    // 中身のブロックは普通に編集できる。
    details: {
      group: "block",
      content: "block+",
      attrs: { ...id, head: { default: "<details>" } },
    },

    // 構造化しない生 HTML（div / form / video など）と、未知のブロック。
    rawBlock: {
      group: "block",
      atom: true,
      attrs: { ...id, value: { default: "" } },
    },

    image: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: {
        src: { default: "" },
        alt: { default: "" },
        title: { default: null as string | null },
      },
    },

    hardBreak: { group: "inline", inline: true, atom: true },

    // 行内の生 HTML（<u> の中身など）と、未知の行内ノード。
    rawInline: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { value: { default: "" } },
    },

    text: { group: "inline" },
  },

  marks: {
    strong: {},
    em: {},
    strike: {},
    code: {},
    link: {
      attrs: { href: { default: "" }, title: { default: null as string | null } },
    },
  },
});

export type MdSchema = typeof schema;

import { Schema, type DOMOutputSpec } from "prosemirror-model";

// 全文編集の編集モデル。Markdown の実データが要求する形だけを持つ。
//
// ノードの顔ぶれは monorepo-docs の 1072 ファイルを数えて決めた。数式と脚注は
// 実質使われていないので入れず、未知のものは原文のまま温存する（rawBlock /
// rawInline）。失うより、触れないほうがいい。
//
// トップレベルのブロックは id を持つ。読み込み時に振り、保存時に「読み込んだ
// ときと同じ内容か」を突き合わせるのに使う。同じなら直列化せず原文をそのまま
// 出すので、触っていない場所は 1 バイトも動かない。
//
// toDOM が出す要素は Markdown.tsx の描画と同じ並びにしてある。本文の入れ物に
// 被せている mg-prose / prose の指定がそのまま効く。

const id = { id: { default: null as string | null } };

// <summary>…</summary> の中身。開きタグは原文のまま持っているので、
// 見出しとして出すぶんだけ取り出す。
const summaryOf = (head: string): string =>
  /<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>/.exec(head)?.[1].trim() ?? "";

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },

    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { ...id },
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0] as DOMOutputSpec,
    },

    heading: {
      group: "block",
      content: "inline*",
      defining: true,
      attrs: { ...id, level: { default: 1 } },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (node) => [`h${node.attrs.level}`, 0] as DOMOutputSpec,
    },

    blockquote: {
      group: "block",
      content: "block+",
      defining: true,
      attrs: { ...id },
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0] as DOMOutputSpec,
    },

    // fenced か字下げか、囲みが ``` か ~~~ かまで覚える。書き戻すときに
    // 元の書き方へ戻すため。
    codeBlock: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      attrs: {
        ...id,
        lang: { default: null as string | null },
        fenced: { default: true },
        fence: { default: "```" },
      },
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
      toDOM: (node) =>
        [
          "pre",
          node.attrs.lang ? { "data-lang": node.attrs.lang } : {},
          ["code", 0],
        ] as DOMOutputSpec,
    },

    bulletList: {
      group: "block",
      content: "listItem+",
      attrs: { ...id, tight: { default: true }, marker: { default: "-" } },
      parseDOM: [{ tag: "ul" }],
      // 詰まった箇条書きは、読むときは項目の中に段落が出ない。編集面では
      // 段落を持つので、印を付けて余白を落とす。
      toDOM: (node) =>
        ["ul", node.attrs.tight ? { "data-tight": "true" } : {}, 0] as DOMOutputSpec,
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
      parseDOM: [
        {
          tag: "ol",
          getAttrs: (dom: HTMLElement) => ({
            start: dom.hasAttribute("start") ? Number(dom.getAttribute("start")) : 1,
          }),
        },
      ],
      toDOM: (node) =>
        [
          "ol",
          {
            ...(node.attrs.start === 1 ? {} : { start: node.attrs.start }),
            ...(node.attrs.tight ? { "data-tight": "true" } : {}),
          },
          0,
        ] as DOMOutputSpec,
    },

    // checked が null なら普通の項目、true / false ならタスク。
    listItem: {
      content: "block+",
      defining: true,
      attrs: { checked: { default: null as boolean | null } },
      parseDOM: [{ tag: "li" }],
      toDOM: (node) =>
        [
          "li",
          node.attrs.checked === null ? {} : { "data-checked": String(node.attrs.checked) },
          0,
        ] as DOMOutputSpec,
    },

    // widths は原文の桁幅。編集したセルの列だけが広がり、他は動かない。
    table: {
      group: "block",
      content: "tableRow+",
      isolating: true,
      attrs: {
        ...id,
        align: { default: [] as (string | null)[] },
        widths: { default: [] as number[] },
        delim: { default: null as string | null },
      },
      parseDOM: [{ tag: "table" }],
      // 読むときと同じ入れ子にする。列幅はラッパーと .mg-cell が決めていて、
      // 素の table だけを出すと桁が潰れて変なところで折り返す。
      toDOM: () =>
        [
          "div",
          { class: "mg-table-wrap overflow-x-auto" },
          ["table", ["tbody", 0]],
        ] as DOMOutputSpec,
    },

    tableRow: {
      content: "tableCell+",
      parseDOM: [{ tag: "tr" }],
      toDOM: () => ["tr", 0] as DOMOutputSpec,
    },

    tableCell: {
      content: "inline*",
      isolating: true,
      attrs: { header: { default: false } },
      parseDOM: [
        { tag: "td", attrs: { header: false } },
        { tag: "th", attrs: { header: true } },
      ],
      toDOM: (node) =>
        [node.attrs.header ? "th" : "td", ["div", { class: "mg-cell" }, 0]] as DOMOutputSpec,
    },

    thematicBreak: {
      group: "block",
      attrs: { ...id, marker: { default: "---" } },
      parseDOM: [{ tag: "hr" }],
      toDOM: () => ["hr"] as DOMOutputSpec,
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
      parseDOM: [{ tag: "div.mg-callout" }],
      toDOM: (node) =>
        [
          "div",
          {
            class: "mg-callout notion",
            ...(node.attrs.color ? { "data-color": node.attrs.color } : {}),
          },
          ["span", { class: "mg-callout-ico", contenteditable: "false" }, node.attrs.icon],
          ["div", { class: "mg-callout-body" }, 0],
        ] as DOMOutputSpec,
    },

    // 開きタグから </summary> までは原文のまま持つ。実データの summary は
    // 複数行に割れていたり入れ子になっていたりで、組み直すと崩れる。
    // 中身のブロックは普通に編集できる。
    details: {
      group: "block",
      content: "block+",
      attrs: { ...id, head: { default: "<details>" } },
      parseDOM: [{ tag: "div.mg-details" }],
      toDOM: (node) =>
        [
          "div",
          { class: "mg-details" },
          [
            "div",
            { class: "mg-details-head", contenteditable: "false" },
            summaryOf(node.attrs.head),
          ],
          ["div", { class: "mg-details-body" }, 0],
        ] as DOMOutputSpec,
    },

    // 構造化しない生 HTML（div / form / video など）と、未知のブロック。
    rawBlock: {
      group: "block",
      atom: true,
      attrs: { ...id, value: { default: "" } },
      parseDOM: [{ tag: "div.mg-raw" }],
      toDOM: (node) =>
        ["div", { class: "mg-raw", contenteditable: "false" }, node.attrs.value] as DOMOutputSpec,
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
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs: (dom: HTMLElement) => ({
            src: dom.getAttribute("src") ?? "",
            alt: dom.getAttribute("alt") ?? "",
            title: dom.getAttribute("title"),
          }),
        },
      ],
      toDOM: (node) =>
        [
          "img",
          { src: node.attrs.src, alt: node.attrs.alt, ...(node.attrs.title ? { title: node.attrs.title } : {}) },
        ] as DOMOutputSpec,
    },

    hardBreak: {
      group: "inline",
      inline: true,
      atom: true,
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"] as DOMOutputSpec,
    },

    // 行内の生 HTML（<u> の中身など）と、未知の行内ノード。
    rawInline: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { value: { default: "" } },
      parseDOM: [{ tag: "span.mg-raw-inline" }],
      toDOM: (node) =>
        [
          "span",
          { class: "mg-raw-inline", contenteditable: "false" },
          node.attrs.value,
        ] as DOMOutputSpec,
    },

    text: { group: "inline" },
  },

  marks: {
    link: {
      attrs: { href: { default: "" }, title: { default: null as string | null } },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom: HTMLElement) => ({
            href: dom.getAttribute("href") ?? "",
            title: dom.getAttribute("title"),
          }),
        },
      ],
      toDOM: (node) =>
        [
          "a",
          { href: node.attrs.href, ...(node.attrs.title ? { title: node.attrs.title } : {}) },
          0,
        ] as DOMOutputSpec,
    },

    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0] as DOMOutputSpec,
    },

    em: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM: () => ["em", 0] as DOMOutputSpec,
    },

    strike: {
      parseDOM: [{ tag: "del" }, { tag: "s" }],
      toDOM: () => ["del", 0] as DOMOutputSpec,
    },

    code: {
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0] as DOMOutputSpec,
    },
  },
});

export type MdSchema = typeof schema;

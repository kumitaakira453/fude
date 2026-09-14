import { Schema, type DOMOutputSpec } from "prosemirror-model";
import { CALLOUT_RE } from "../callout";

// 全文編集の編集モデル。Markdown の実データが要求する形だけを持つ。
//
// ノードの顔ぶれは monorepo-docs の 1072 ファイルを数えて決めた。脚注は実質
// 使われていないので入れず、未知のものは原文のまま温存する（rawBlock /
// rawInline）。失うより、触れないほうがいい。
//
// トップレベルのブロックは id を持つ。読み込み時に振り、保存時に「読み込んだ
// ときと同じ内容か」を突き合わせるのに使う。同じなら直列化せず原文をそのまま
// 出すので、触っていない場所は 1 バイトも動かない。
//
// toDOM が出す要素は Markdown.tsx の描画と同じ並びにしてある。本文の入れ物に
// 被せている mg-prose / prose の指定がそのまま効く。

const id = { id: { default: null as string | null } };

const SUMMARY = /(<summary(?:\s[^>]*)?>)([\s\S]*?)(<\/summary>)/;
// 見出しトグル。<summary> の中身がまるごと見出しになっている形。
const HEADING = /^\s*<h([1-6])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>\s*$/;

const insideSummary = (head: string): string => SUMMARY.exec(head)?.[2] ?? "";

// <summary>…</summary> の中身。開きタグは原文のまま持っているので、
// 見出しとして出すぶんだけ取り出す。見出しトグルならタグの中の字を返す。
export const summaryOf = (head: string): string => {
  const inner = insideSummary(head);
  return (HEADING.exec(inner)?.[2] ?? inner).trim();
};

// 見出しトグルの階層。ただのトグルなら null。
export const headLevelOf = (head: string): number | null => {
  const level = HEADING.exec(insideSummary(head))?.[1];
  return level ? Number(level) : null;
};

// 新しく作るトグルの開きタグ。書き戻しは開き・中身・閉じの間を 1 行空けるので、
// この形のまま読み直せる。
//
// 作った直後は開いておく。畳まれた状態で出ると、これから書く中身が見えない。
export const DETAILS_HEAD = "<details open>";

// 見出しをトグルの頭にした形。原文は生 HTML なので、見出しもタグで書く。
export const headingHead = (level: number, text: string): string =>
  `<details open>\n<summary><h${level}>${text}</h${level}></summary>`;

// 打ち直した見出しを、開きタグの <summary> の中身へ差し戻す。開きタグの属性や
// 前後の行は原文のまま残し、見出しトグルなら見出しのタグも残す。
export const withSummary = (head: string, text: string): string =>
  fillSummary(head, text, headLevelOf(head));

// 見出しの階層を付け替える。null を渡すと素のトグルへ戻す。
export const withHeadLevel = (head: string, level: number | null): string =>
  fillSummary(head, summaryOf(head), level);

function fillSummary(head: string, text: string, level: number | null): string {
  const body = level === null ? text : `<h${level}>${text}</h${level}>`;
  return SUMMARY.test(head)
    ? head.replace(SUMMARY, (_, open: string, _inner: string, close: string) => open + body + close)
    : `${head}\n<summary>${body}</summary>`;
}

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
      // 目印の無い引用は、読むときと同じ「大きく見せる引用」にする。
      // 効かせるかどうかは .mg-editorial 側の指定が決める。
      toDOM: (node) =>
        [
          "blockquote",
          CALLOUT_RE.test(node.textContent) ? {} : { class: "mg-pull" },
          0,
        ] as DOMOutputSpec,
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
      // 番号は CSS の counter で描くので、途中から始まる並びは変数でも渡す
      // （counter は start 属性を見ない）。
      toDOM: (node) =>
        [
          "ol",
          {
            class: "mg-steps",
            ...(node.attrs.start === 1
              ? {}
              : { start: node.attrs.start, style: `--mg-start:${node.attrs.start - 1}` }),
            ...(node.attrs.tight ? { "data-tight": "true" } : {}),
          },
          0,
        ] as DOMOutputSpec,
    },

    // checked が null なら普通の項目、true / false ならタスク。
    //
    // 印は DOM からも読み返す。編集面が DOM の差分を読み直したときや、項目を
    // コピーして貼ったときに、書いた印をそのまま拾えないと素の項目に戻る。
    listItem: {
      content: "block+",
      defining: true,
      attrs: { checked: { default: null as boolean | null } },
      parseDOM: [
        {
          tag: "li",
          getAttrs: (dom: HTMLElement) => ({
            checked: dom.dataset.checked === undefined ? null : dom.dataset.checked === "true",
          }),
        },
      ],
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
      // prosemirror-tables が表の形を読むための役割。矢印キーでの行き来と
      // セルの選択がこれで効く。
      tableRole: "table",
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
      tableRole: "row",
      parseDOM: [{ tag: "tr" }],
      toDOM: () => ["tr", 0] as DOMOutputSpec,
    },

    tableCell: {
      content: "inline*",
      isolating: true,
      tableRole: "cell",
      // colspan / rowspan は GFM の表には無いが、prosemirror-tables が
      // 形を数えるのに読むので持たせる。
      attrs: {
        header: { default: false },
        colspan: { default: 1 },
        rowspan: { default: 1 },
        colwidth: { default: null as number[] | null },
      },
      parseDOM: [
        { tag: "td", attrs: { header: false } },
        { tag: "th", attrs: { header: true } },
      ],
      toDOM: (node) =>
        [node.attrs.header ? "th" : "td", ["div", { class: "mg-cell" }, 0]] as DOMOutputSpec,
    },

    thematicBreak: {
      group: "block",
      // 節点として選べないようにする。中身を持たない区切りなので選ぶ意味が無く、
      // 選ぶと横いっぱいの枠が出て空の入力欄のように見える。後ろの行頭からの
      // Backspace では変わらず消える。
      selectable: false,
      attrs: { ...id, marker: { default: "---" } },
      parseDOM: [{ tag: "hr" }, { tag: "div.mg-hr" }],
      // 読むときと同じ素の罫。見た目は本文の指定（typography）が持つ。
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

    // トグルの題。原文では <summary> の中身。本文の節点として持つので、押した
    // ところにカーソルが入り、矢印で行き来でき、変換もそのまま効く（入力欄で
    // 出していた頃は、本文の外に居るぶんどれも自前で面倒を見る必要があった）。
    //
    // level が入っていれば見出しトグル。組み方は本文の見出しの指定に揃う。
    detailsSummary: {
      content: "inline*",
      defining: true,
      attrs: { level: { default: null as number | null } },
      parseDOM: [{ tag: "div.mg-details-head" }],
      toDOM: (node) =>
        [
          "div",
          { class: "mg-details-head" },
          node.attrs.level
            ? [`h${node.attrs.level}`, { class: "mg-details-title" }, 0]
            : ["span", { class: "mg-details-title" }, 0],
        ] as DOMOutputSpec,
    },

    // 開きタグは原文のまま持つ（属性が付くことがある）。題は最初の子、
    // 中身はその後ろのブロック。
    details: {
      group: "block",
      content: "detailsSummary block+",
      attrs: { ...id, head: { default: "<details>" } },
      parseDOM: [{ tag: "div.mg-details" }],
      toDOM: () => ["div", { class: "mg-details" }, 0] as DOMOutputSpec,
    },

    // 独立した数式（$$…$$）。読むときは KaTeX で組まれるので、編集面でも
    // 同じに見せる（NodeView が描く）。tex は中身、raw は原文の書き方
    // （打ち直したら null にする）。
    mathBlock: {
      group: "block",
      atom: true,
      attrs: { ...id, tex: { default: "" }, raw: { default: null as string | null } },
      parseDOM: [
        {
          tag: "div.mg-math-block",
          getAttrs: (dom: HTMLElement) => ({
            tex: dom.getAttribute("data-tex") ?? "",
            raw: null,
          }),
        },
      ],
      toDOM: (node) =>
        [
          "div",
          { class: "mg-math-block", "data-tex": node.attrs.tex },
          node.attrs.tex as string,
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

    // 行内の数式（$…$）。読むときは KaTeX で組まれるので、編集面でも同じに
    // 見せる（NodeView が描く）。tex は中身、raw は原文の書き方（$$…$$ で
    // 書かれていたものを $…$ に直さないため。打ち直したら null にする）。
    inlineMath: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { tex: { default: "" }, raw: { default: null as string | null } },
      parseDOM: [
        {
          tag: "span.mg-math",
          getAttrs: (dom: HTMLElement) => ({
            tex: dom.getAttribute("data-tex") ?? "",
            raw: null,
          }),
        },
      ],
      toDOM: (node) =>
        [
          "span",
          { class: "mg-math", "data-tex": node.attrs.tex },
          node.attrs.tex as string,
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
      // <br> は字ではなく実際の改行として出す。表のセルの中で行を分けるのに
      // 使う（GFM の表は行を分けられないので、原文でもこの形になる）。
      toDOM: (node) =>
        /^<br\s*\/?>$/i.test(node.attrs.value)
          ? (["br"] as DOMOutputSpec)
          : ([
          "span",
          { class: "mg-raw-inline", contenteditable: "false" },
          node.attrs.value,
        ] as DOMOutputSpec),
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

    // Markdown に下線の記号は無く、実データは生の <u> で書かれている
    // （1072 ファイルに 160 か所）。印として持ち、書き戻すときも同じ形で出す。
    underline: {
      parseDOM: [{ tag: "u" }],
      toDOM: () => ["u", 0] as DOMOutputSpec,
    },

    // 囲みの直後で打った字は中に入れない。記号を画面に出さないので、入ると
    // 囲みから出る手立てが無くなる（閉じの ` を消せない）。伸ばしたいときは、
    // 消した字を打ち直すか、範囲を選んで付け直す。
    code: {
      inclusive: false,
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0] as DOMOutputSpec,
    },
  },
});

export type MdSchema = typeof schema;

// 行内の装飾の入れ子の順序。外側から link → underline → strong → em →
// strike → code。
//
// Markdown の記号は必ず入れ子になるので、装飾の重なりはこの順序でしか書けない。
// 原文へ戻すときの入れ子と、打った字が継ぐ装飾の判断で同じ並びを使う。
// 下線が強調より外なのは実データの書き方に合わせたため（`<u>**字**</u>`）。
const INLINE_NEST = ["link", "underline", "strong", "em", "strike", "code"];

// 外側から数えた深さ。並びに無い装飾は、いちばん外側として扱う。
export const nestOf = (name: string): number => INLINE_NEST.indexOf(name);

import type { Mark, Node as PmNode } from "prosemirror-model";
import type {
  BlockContent,
  DefinitionContent,
  Parent,
  PhrasingContent,
  RootContent,
  Table,
} from "mdast";
import { gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown as mdastToMarkdown, type Options } from "mdast-util-to-markdown";
import { fromMarkdown, parseTree, type Loaded, type Span } from "./fromMarkdown";
import { nestOf, schema } from "./schema";
import { splitRow } from "../blocks";
import { plainEdit, sameShape, spliceNode } from "./splice";

// 編集モデルを Markdown へ戻す。
//
// 要は「触っていない場所を 1 バイトも動かさない」こと。触られていないブロックは
// 直列化せず原文をそのまま出し、間の空行も原文から取る。編集されたブロックだけを
// 組み直す。実データ 1072 ファイルで、無編集なら完全一致になる。
//
// 表は remark の流儀で組み直すと桁揃えが全部動くので、原文の桁幅を覚えておいて
// そこへ詰め直す。編集したセルの列だけが広がり、他の列は動かない。

// 下線。Markdown に記号が無いので、実データと同じ生の <u> で書き出す。
// mdast に無い節点を足すので、remark の作法どおり型も足しておく。
interface Underline extends Parent {
  type: "mgUnderline";
  children: PhrasingContent[];
}

declare module "mdast" {
  interface PhrasingContentMap {
    mgUnderline: Underline;
  }
  interface RootContentMap {
    mgUnderline: Underline;
  }
}

// 実データの書き方に寄せた設定。箇条書きは "-"、強調は "**"、水平線は "---"。
const OPTIONS: Options = {
  extensions: [gfmToMarkdown({ tablePipeAlign: false })],
  handlers: {
    mgUnderline: (node, _parent, state, info) => {
      if (node.type !== "mgUnderline") return "";
      // 前後にタグの山かっこが立つので、逃がしの判断もそれで見させる。
      return `<u>${state.containerPhrasing(node, { ...info, before: ">", after: "<" })}</u>`;
    },
  },
  bullet: "-",
  bulletOther: "*",
  emphasis: "*",
  strong: "*",
  fence: "`",
  fences: true,
  rule: "-",
  listItemIndent: "one",
  tightDefinitions: true,
};

// トップレベルのブロック 1 つと、そこから出た Markdown。
//
// 指摘の居場所は「引用のブロックの原文」で決めるので、編集面ではこの対で
// 突き合わせる。全文の中での位置は持たない（消したブロックの分を詰めるとき、
// 後ろの位置が全部動くため）。
export interface Part {
  pos: number;
  src: string;
}

export function toMarkdown(doc: PmNode, loaded: Loaded): string {
  return toMarkdownParts(doc, loaded).text;
}

export function toMarkdownParts(
  doc: PmNode,
  loaded: Loaded,
): { text: string; parts: Part[] } {
  const parts: Part[] = [];
  let out = "";
  // 直前のブロックが原文のどこで終わったか。続けて原文から出すときは、
  // 間の空行もそのまま持ってくる。
  let prevEnd: number | null = 0;

  // まだ残っているブロックの目印。原文から持ってくる区間に、消されたブロックが
  // 挟まっていないかを見るのに使う。
  const alive = new Set<string>();
  doc.forEach((node) => {
    const id = node.attrs.id as string | null;
    if (id) alive.add(id);
  });

  // 原文の [from, to) を持ってくる。消されたブロックの分は抜く。
  //
  // 空きをそのまま持ってくるだけだと、消したブロックの本文が「間の空き」として
  // 戻ってしまう。ブロックにならなかったもの（注釈など）は原文のまま残る。
  let dropped = false;
  const between = (from: number, to: number): string => {
    let text = "";
    let at = from;
    for (const [id, [start, end]] of loaded.ranges) {
      if (alive.has(id) || start < at || end > to) continue;
      text += loaded.source.slice(at, start);
      at = end;
      dropped = true;
    }
    return text + loaded.source.slice(at, to);
  };

  doc.forEach((node, offset, index) => {
    const kept = keep(node, loaded);
    const gap =
      prevEnd !== null && kept && prevEnd <= kept.span.start
        ? between(prevEnd, kept.span.start)
        : index === 0
          ? ""
          : "\n\n";
    const src = kept ? kept.text : blockText(node);
    parts.push({ pos: offset, src });
    out += gap + src;
    prevEnd = kept ? kept.span.end : null;
  });

  const text =
    prevEnd !== null
      ? out + between(prevEnd, loaded.source.length)
      : out.endsWith("\n")
        ? out
        : `${out}\n`;
  if (!dropped) return { text, parts };
  // 抜いたあとに空行が余る。詰めるのは消したときだけ（原文が持っている空行を
  // 勝手に詰めない）。
  return {
    text: text
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, "")
      .replace(/\n*$/, "\n"),
    parts,
  };
}

// 原文から出せるなら、その文字列と範囲を返す。
//
// 触られていなければ原文そのまま。書き換わっていても、形が同じなら変わった
// ところだけを差し込む。差し込んだ結果を読み直して狙いどおりのときだけ採用し、
// そうでなければ null を返して丸ごと組み直す経路へ渡す。
function keep(node: PmNode, loaded: Loaded): { text: string; span: Span } | null {
  const id = node.attrs.id as string | null;
  if (!id) return null;
  const before = loaded.originals.get(id);
  const span = loaded.spans.get(id);
  if (!before || !span) return null;
  if (before.eq(node)) return { text: loaded.source.slice(span.start, span.end), span };

  const text = spliceNode(before, node, span, loaded.source);
  if (text === null) return null;
  const raw = loaded.source.slice(span.start, span.end);
  if (plainEdit(raw, text)) return { text, span };

  const back = fromMarkdown(text).doc;
  if (back.childCount !== 1 || !sameShape(back.child(0), node)) return null;
  return { text, span };
}

// ---- ブロック ----

export function blockText(node: PmNode): string {
  const md = toMdast(node);
  const text = mdastToMarkdown({ type: "root", children: [md] }, OPTIONS).replace(/\n+$/, "");
  return relax(text);
}

// 独自のノードは、あらかじめ組み立てた文字列を持つ html ノードにする。
// mdast は html の値をそのまま出すので、引用や箇条書きの中に入っても
// 前置きの "> " や字下げが正しく付く。
const verbatim = (value: string): RootContent => ({ type: "html", value });

function toMdast(node: PmNode): RootContent {
  switch (node.type.name) {
    case "paragraph":
      return { type: "paragraph", children: inlineToMdast(node) };

    case "heading":
      return { type: "heading", depth: node.attrs.level, children: inlineToMdast(node) };

    case "blockquote":
      return { type: "blockquote", children: childBlocks(node) };

    case "codeBlock":
      return {
        type: "code",
        lang: node.attrs.lang,
        meta: null,
        value: node.textContent,
      };

    case "bulletList":
    case "orderedList": {
      const ordered = node.type.name === "orderedList";
      return {
        type: "list",
        ordered,
        start: ordered ? node.attrs.start : null,
        spread: !node.attrs.tight,
        children: mapChildren(node, (item) => {
          const box = item.attrs.checked as boolean | null;
          // 中身の無いタスク項目は GFM の印では書けない（印だけを書くと
          // 「[ ]」という字として読まれ、素の項目になって点が出る）。
          // 印を字として残し、読む側で空のタスク項目へ戻す。
          if (box !== null && hollow(item)) {
            return {
              type: "listItem" as const,
              checked: null,
              spread: false,
              children: [
                {
                  type: "paragraph" as const,
                  children: [
                    { type: "text" as const, value: box ? "[x]" : "[ ]" },
                  ],
                },
              ],
            };
          }
          return {
            type: "listItem" as const,
            checked: box,
            // callout は Markdown に無いタグなので、HTML ブロックとして読ませる
            // には前に空行が要る（未知タグの塊は段落の途中に割り込めない）。
            // 空行なしで書くと、読み直したときタグが字になって囲みが消える。
            spread: heldCallout(item),
            children: childBlocks(item),
          };
        }),
      };
    }

    case "table":
      return verbatim(tableText(node));

    case "thematicBreak":
      return verbatim(node.attrs.marker || "---");

    case "mathBlock":
      return verbatim(mathText(node, "$$"));

    case "callout": {
      const attrs = [
        node.attrs.icon ? `icon="${node.attrs.icon}"` : "",
        node.attrs.color ? `color="${node.attrs.color}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const open = attrs ? `<callout ${attrs}>` : "<callout>";
      return verbatim([open, ...mapChildren(node, blockText), "</callout>"].join("\n"));
    }

    case "details": {
      // 先頭の子は題。開きタグと <summary> に組み直し、残りが中身になる。
      // Notion が書き出す形に合わせ、開き・中身・閉じの間を 1 行空ける。
      // 中身の無い塊は書き出さない（畳んだ直後の空のトグルで、空行だけが
      // 積み上がる）。読み直すと空の段落へ戻るので、往復しても同じ。
      const body: string[] = [];
      let title = "";
      node.forEach((child, _offset, index) => {
        if (index === 0 && child.type === schema.nodes.detailsSummary) {
          const text = titleText(child);
          const level = child.attrs.level as number | null;
          title = level === null ? text : `<h${level}>${text}</h${level}>`;
          return;
        }
        const out = blockText(child);
        if (out) body.push(out);
      });
      return verbatim(
        [`${node.attrs.head}\n<summary>${title}</summary>`, ...body, "</details>"].join("\n\n"),
      );
    }

    default:
      return verbatim(node.attrs.value ?? "");
  }
}

// トグルの題。行内の印はそのまま Markdown の記号に戻す。落とすのは題の形を
// 壊す字だけ（題は 1 行で、<summary> の中に収まっていなければならない）。
function titleText(node: PmNode): string {
  const md = mdastToMarkdown(
    { type: "root", children: [{ type: "paragraph", children: inlineToMdast(node) }] },
    OPTIONS,
  );
  return relax(md)
    .replace(/\s+$/, "")
    .replace(/\n/g, " ")
    .replace(/<\/?summary(\s[^>]*)?>/g, "");
}

// 数式の書き戻し。触っていなければ原文の書き方のまま、打ち直したら囲み直す。
//
// 中身が空のものは書き出さない。打ち始める前の器なので、囲みの記号だけが
// 残ると原文が壊れる（`$$` が閉じない数式になる）。
function mathText(node: PmNode, fence: string): string {
  const raw = node.attrs.raw as string | null;
  if (raw !== null) return raw;
  const tex = (node.attrs.tex as string).trim();
  if (!tex) return "";
  return fence === "$" ? `$${tex}$` : `$$\n${tex}\n$$`;
}

// 項目の 2 つ目以降の子に callout を持つか。先頭の子なら項目の印の直後に
// 立つので、前の行を割り込む形にならない。
function heldCallout(item: PmNode): boolean {
  for (let i = 1; i < item.childCount; i++) {
    if (item.child(i).type.name === "callout") return true;
  }
  return false;
}

// 中身が空っぽの項目か。段落 1 つだけを持ち、その段落に何も無いもの。
const hollow = (item: PmNode): boolean =>
  item.childCount === 1 &&
  item.firstChild?.type.name === "paragraph" &&
  item.firstChild.content.size === 0;

const childBlocks = (node: PmNode): (BlockContent | DefinitionContent)[] =>
  mapChildren(node, toMdast) as (BlockContent | DefinitionContent)[];

function mapChildren<T>(node: PmNode, f: (child: PmNode) => T): T[] {
  const out: T[] = [];
  node.forEach((child) => out.push(f(child)));
  return out;
}

// ---- 表 ----

const cellsOf = (line: string): string[] => {
  const parts = splitRow(line);
  const head = parts[0].trim() === "" ? 1 : 0;
  const tail = parts.length > 1 && parts.at(-1)!.trim() === "" ? 1 : 0;
  return parts.slice(head, parts.length - tail);
};

// 桁を揃え直さず、覚えていた幅へ詰め直す。中身が幅を超えた列だけが広がる。
function tableText(node: PmNode): string {
  const table: Table = {
    type: "table",
    align: node.attrs.align ?? [],
    children: mapChildren(node, (row) => ({
      type: "tableRow" as const,
      children: mapChildren(row, (cell) => ({
        type: "tableCell" as const,
        children: inlineToMdast(cell),
      })),
    })),
  };
  const plain = mdastToMarkdown({ type: "root", children: [table] }, OPTIONS)
    .replace(/\n+$/, "")
    .split("\n");

  const widths: number[] = node.attrs.widths ?? [];
  const pad = (cell: string, i: number) => {
    const want = widths[i] ?? 0;
    return cell.length >= want ? cell : cell + " ".repeat(want - cell.length);
  };
  const lines = plain.map((line) => `|${cellsOf(line).map(pad).join("|")}|`);

  // 区切り行は、列数が変わっていなければ原文のものを使う。
  const delim: string | null = node.attrs.delim;
  if (delim && cellsOf(delim).length === cellsOf(plain[0]).length) lines[1] = delim;
  return lines.join("\n");
}

// ---- 行内 ----

// 外側から順に並べる。順序は schema が持っている。
const ranked = (marks: readonly Mark[]) =>
  [...marks].sort((a, b) => nestOf(a.type.name) - nestOf(b.type.name));

interface Item {
  marks: Mark[];
  node: PmNode;
}

function inlineToMdast(parent: PmNode): PhrasingContent[] {
  const items: Item[] = mapChildren(parent, (node) => ({ marks: ranked(node.marks), node }));
  return nest(items, 0);
}

function nest(items: Item[], depth: number): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let i = 0;
  while (i < items.length) {
    const mark = items[i].marks[depth];
    if (!mark) {
      out.push(leaf(items[i].node));
      i++;
      continue;
    }
    let j = i;
    while (j < items.length && items[j].marks[depth]?.eq(mark)) j++;
    out.push(wrap(mark, items.slice(i, j), depth));
    i = j;
  }
  return out;
}

function wrap(mark: Mark, items: Item[], depth: number): PhrasingContent {
  // 行内コードは中身を持てないので、文字列に潰して値にする。
  if (mark.type.name === "code") {
    return { type: "inlineCode", value: items.map((x) => x.node.textContent).join("") };
  }
  const children = nest(items, depth + 1);
  switch (mark.type.name) {
    case "strong":
      return { type: "strong", children };
    case "em":
      return { type: "emphasis", children };
    case "strike":
      return { type: "delete", children };
    case "underline":
      return { type: "mgUnderline", children };
    default:
      return { type: "link", url: mark.attrs.href, title: mark.attrs.title, children };
  }
}

function leaf(node: PmNode): PhrasingContent {
  switch (node.type.name) {
    case "image":
      return { type: "image", url: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title };
    case "hardBreak":
      return { type: "break" };
    case "rawInline":
      return { type: "html", value: node.attrs.value };
    case "inlineMath":
      return { type: "html", value: mathText(node, "$") };
    default:
      return { type: "text", value: node.text ?? "" };
  }
}

// ---- エスケープを緩める ----

// remark は "content_scripts" を "content\\_scripts" のように保険で逃がす。
// 語中の _ は CommonMark では強調にならないので、この保険は要らない。
// ただし外して意味が変わっては困るので、外した結果を読み直し、
// 同じ木のままだったときだけ採用する。
const CLASSES = ["_", "*", "#", "-", "+", ".", "!", "|", "[", "]", "(", ")", "<", ">", "~", "`"];

const bare = (text: string): string =>
  JSON.stringify(parseTree(text), (key, value) => (key === "position" ? undefined : value));

function relax(text: string): string {
  if (!text.includes("\\")) return text;
  const want = bare(text);
  const drop = (t: string, classes: string[]) =>
    classes.reduce((acc, ch) => acc.replaceAll(`\\${ch}`, ch), t);
  const keeps = (t: string) => bare(t) === want;

  const all = drop(text, CLASSES);
  if (all !== text && keeps(all)) return all;

  // まとめて外せないときは、記号ごとに外せるものだけ外す。
  let out = text;
  for (const ch of CLASSES) {
    const next = drop(out, [ch]);
    if (next !== out && keeps(next)) out = next;
  }
  return out;
}

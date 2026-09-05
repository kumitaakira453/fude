import type { Mark, Node as PmNode } from "prosemirror-model";
import type {
  BlockContent,
  DefinitionContent,
  PhrasingContent,
  RootContent,
  Table,
} from "mdast";
import { gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown as mdastToMarkdown, type Options } from "mdast-util-to-markdown";
import { parseTree, type Loaded } from "./fromMarkdown";
import { splitRow } from "../blocks";
import { pristineRange } from "./pristine";

// 編集モデルを Markdown へ戻す。
//
// 要は「触っていない場所を 1 バイトも動かさない」こと。触られていないブロックは
// 直列化せず原文をそのまま出し、間の空行も原文から取る。編集されたブロックだけを
// 組み直す。実データ 1072 ファイルで、無編集なら完全一致になる。
//
// 表は remark の流儀で組み直すと桁揃えが全部動くので、原文の桁幅を覚えておいて
// そこへ詰め直す。編集したセルの列だけが広がり、他の列は動かない。

// 実データの書き方に寄せた設定。箇条書きは "-"、強調は "**"、水平線は "---"。
const OPTIONS: Options = {
  extensions: [gfmToMarkdown({ tablePipeAlign: false })],
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

export function toMarkdown(doc: PmNode, loaded: Loaded): string {
  let out = "";
  // 直前のブロックが原文のどこで終わったか。続けて原文から出すときは、
  // 間の空行もそのまま持ってくる。
  let prevEnd: number | null = 0;

  doc.forEach((node, _offset, index) => {
    const range = pristineRange(node, loaded);
    const gap =
      prevEnd !== null && range && prevEnd <= range[0]
        ? loaded.source.slice(prevEnd, range[0])
        : index === 0
          ? ""
          : "\n\n";
    out += gap;
    out += range ? loaded.source.slice(range[0], range[1]) : blockText(node);
    prevEnd = range ? range[1] : null;
  });

  if (prevEnd !== null) return out + loaded.source.slice(prevEnd);
  return out.endsWith("\n") ? out : `${out}\n`;
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
        children: mapChildren(node, (item) => ({
          type: "listItem" as const,
          checked: item.attrs.checked,
          spread: false,
          children: childBlocks(item),
        })),
      };
    }

    case "table":
      return verbatim(tableText(node));

    case "thematicBreak":
      return verbatim(node.attrs.marker || "---");

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

    case "details":
      // Notion が書き出す形に合わせ、開き・中身・閉じの間を 1 行空ける。
      return verbatim(
        [node.attrs.head, ...mapChildren(node, blockText), "</details>"].join("\n\n"),
      );

    default:
      return verbatim(node.attrs.value ?? "");
  }
}

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

// 入れ子の順序。外側から link → strong → em → strike → code。
const RANK = ["link", "strong", "em", "strike", "code"];
const ranked = (marks: readonly Mark[]) =>
  [...marks].sort((a, b) => RANK.indexOf(a.type.name) - RANK.indexOf(b.type.name));

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

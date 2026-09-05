import type { Mark, Node as PmNode } from "prosemirror-model";
import type { Root, RootContent, PhrasingContent } from "mdast";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { schema } from "./schema";
import { splitRow } from "../blocks";

// Markdown を編集モデルへ写す。
//
// パーサ構成は projection.ts と同一にしてある。remark-cjk-friendly は
// 「**強調**を」のような閉じ記号の直後が CJK のときの成立条件を変えるため、
// 構成が違うと描画と編集で境界がずれる。

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(remarkMath);

// 直列化した結果を読み直して確かめる側からも使う。
export const parseTree = (text: string): Root => processor.parse(text) as Root;

export interface Loaded {
  doc: PmNode;
  // frontmatter を除いた本文。id ごとの範囲はこの文字列の上の位置。
  source: string;
  ranges: Map<string, [number, number]>;
  originals: Map<string, PmNode>;
}

// ---- 囲み（callout / details）----

const KINDS = {
  callout: { open: /^<callout(\s[^>]*)?>$/, close: "</callout>" },
  details: { open: /^<details(\s[^>]*)?>$/, close: "</details>" },
} as const;

type Kind = keyof typeof KINDS;

const SUMMARY_CLOSE = "</summary>";

const attrOf = (attrs: string, name: string): string =>
  new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? "";

interface Group {
  kind: Kind | "plain";
  node?: RootContent;
  start: number;
  end: number;
  attrs?: string;
  head?: string;
  innerStart?: number;
  innerEnd?: number;
}

const lineEnd = (text: string, from: number): number => {
  const at = text.indexOf("\n", from);
  return at < 0 ? text.length : at;
};

// 囲みの開きと閉じは、別の html ノードに割れることも、入れ子になることもある
// （中身に空行があると CommonMark の HTML ブロックがそこで終わる）。開きの行から
// 数えて釣り合う閉じの行までをひと塊にする。
function group(children: RootContent[], source: string): Group[] {
  const out: Group[] = [];

  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? source.length;

    const first = node.type === "html" ? source.slice(start, lineEnd(source, start)).trim() : "";
    const kind = (Object.keys(KINDS) as Kind[]).find((k) => KINDS[k].open.test(first));
    const pair = kind ? closeOf(children, i, source, kind) : null;
    if (!kind || !pair) {
      out.push({ kind: "plain", node, start, end });
      continue;
    }

    // details は開きから </summary> までを原文のまま持つ。実データの summary は
    // 複数行に割れていることが多く、組み直すと崩れる。
    let head = source.slice(start, lineEnd(source, start));
    if (kind === "details") {
      const at = source.slice(start, pair.closeStart).indexOf(SUMMARY_CLOSE);
      if (at >= 0) head = source.slice(start, start + at + SUMMARY_CLOSE.length);
    }

    out.push({
      kind,
      start,
      end: pair.closeStart + KINDS[kind].close.length,
      attrs: KINDS[kind].open.exec(first)?.[1]?.trim() ?? "",
      head,
      innerStart: Math.min(start + head.length + 1, pair.closeStart),
      innerEnd: pair.closeStart,
    });
    i = pair.index;
  }

  return out;
}

// 釣り合う閉じ行を探す。入れ子の開きは数える。
function closeOf(
  children: RootContent[],
  from: number,
  source: string,
  kind: Kind,
): { index: number; closeStart: number } | null {
  const { open, close } = KINDS[kind];
  let depth = 0;
  for (let i = from; i < children.length; i++) {
    const node = children[i];
    if (node.type !== "html") continue;
    let at = node.position?.start.offset ?? 0;
    const stop = node.position?.end.offset ?? source.length;
    while (at < stop) {
      const to = Math.min(lineEnd(source, at), stop);
      const line = source.slice(at, to).trim();
      if (open.test(line)) depth++;
      else if (line === close) {
        depth--;
        if (depth === 0) return { index: i, closeStart: at };
      }
      at = to + 1;
    }
  }
  return null;
}

// ---- 表 ----

const cellsOf = (line: string): string[] => {
  const parts = splitRow(line);
  const head = parts[0].trim() === "" ? 1 : 0;
  const tail = parts.length > 1 && parts.at(-1)!.trim() === "" ? 1 : 0;
  return parts.slice(head, parts.length - tail);
};

// 桁揃えと区切り行を覚える。
//
// 実データの表 3,848 個のうち桁が揃っているのは 218 個だけで、残りは
// "| a | b |" と素で書かれている。揃っている列だけ幅を覚え、揃っていない列は
// 0 にして詰めない。揃えてあったものは揃ったまま、素のものは素のまま返る。
function tableStyle(src: string): { widths: number[]; delim: string | null } {
  const lines = src.split("\n").filter((l) => l.trim() !== "");
  const rows = lines.map(cellsOf);
  const columns = Math.max(...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let i = 0; i < columns; i++) {
    const lengths = new Set(rows.filter((r) => r.length > i).map((r) => r[i].length));
    widths[i] = lengths.size === 1 ? [...lengths][0] : 0;
  }
  return { widths, delim: lines[1] ?? null };
}

// ---- 変換 ----

export function fromMarkdown(source: string): Loaded {
  const ranges = new Map<string, [number, number]>();
  const originals = new Map<string, PmNode>();
  const blocks: PmNode[] = [];
  let seq = 0;

  for (const g of group(parseTree(source).children, source)) {
    const id = `b${seq++}`;
    const node = nodeOf(g, source, id);
    if (!node) continue;
    ranges.set(id, [g.start, g.end]);
    originals.set(id, node);
    blocks.push(node);
  }

  const doc = schema.nodes.doc.create(null, blocks.length ? blocks : [empty()]);
  return { doc, source, ranges, originals };
}

const empty = () => schema.nodes.paragraph.create();

function nodeOf(g: Group, source: string, id: string | null): PmNode | null {
  const attrs = id ? { id } : {};
  if (g.kind === "plain") return blockOf(g.node!, source, id);

  const inner = blocksOfText(source.slice(g.innerStart!, g.innerEnd!));
  if (g.kind === "details") {
    return schema.nodes.details.create({ ...attrs, head: g.head }, inner);
  }
  return schema.nodes.callout.create(
    {
      ...attrs,
      icon: attrOf(g.attrs ?? "", "icon"),
      color: attrOf(g.attrs ?? "", "color") || null,
    },
    inner,
  );
}

// 囲みの中身は文字列から読み直す。入れ子も同じ道を通る。
function blocksOfText(text: string): PmNode[] {
  const out: PmNode[] = [];
  for (const g of group(parseTree(text).children, text)) {
    const node = nodeOf(g, text, null);
    if (node) out.push(node);
  }
  return out.length ? out : [empty()];
}

function blocksOf(nodes: RootContent[], source: string): PmNode[] {
  const out: PmNode[] = [];
  for (const g of group(nodes, source)) {
    const node = nodeOf(g, source, null);
    if (node) out.push(node);
  }
  return out.length ? out : [empty()];
}

const slice = (node: RootContent | PhrasingContent, source: string): string =>
  source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);

function blockOf(node: RootContent, source: string, id: string | null): PmNode | null {
  const attrs = id ? { id } : {};
  switch (node.type) {
    case "paragraph":
      return schema.nodes.paragraph.create(attrs, inlineOf(node.children, source));

    case "heading":
      return schema.nodes.heading.create(
        { ...attrs, level: node.depth },
        inlineOf(node.children, source),
      );

    case "blockquote":
      return schema.nodes.blockquote.create(attrs, blocksOf(node.children, source));

    case "code": {
      const src = slice(node, source);
      const fence = /^\s*(`{3,}|~{3,})/.exec(src)?.[1] ?? null;
      const text = node.value === "" ? [] : [schema.text(node.value)];
      return schema.nodes.codeBlock.create(
        { ...attrs, lang: node.lang ?? null, fenced: fence !== null, fence: fence ?? "```" },
        text,
      );
    }

    case "list": {
      const src = slice(node, source);
      const items = node.children.map((item) =>
        schema.nodes.listItem.create(
          { checked: item.checked ?? null },
          blocksOf(item.children, source),
        ),
      );
      const tight = !node.spread;
      if (node.ordered) {
        const marker = /^\s*\d+([.)])/.exec(src)?.[1] ?? ".";
        return schema.nodes.orderedList.create(
          { ...attrs, tight, start: node.start ?? 1, marker },
          items,
        );
      }
      const marker = /^\s*([-*+])/.exec(src)?.[1] ?? "-";
      return schema.nodes.bulletList.create({ ...attrs, tight, marker }, items);
    }

    case "table": {
      const { widths, delim } = tableStyle(slice(node, source));
      const rows = node.children.map((row, r) =>
        schema.nodes.tableRow.create(
          null,
          row.children.map((cell) =>
            schema.nodes.tableCell.create({ header: r === 0 }, inlineOf(cell.children, source)),
          ),
        ),
      );
      return schema.nodes.table.create({ ...attrs, align: node.align ?? [], widths, delim }, rows);
    }

    case "thematicBreak":
      return schema.nodes.thematicBreak.create({ ...attrs, marker: slice(node, source).trim() });

    default:
      // 生 HTML・定義・脚注・数式など。構造化せず原文のまま持つ。
      return schema.nodes.rawBlock.create({ ...attrs, value: slice(node, source) });
  }
}

function inlineOf(nodes: PhrasingContent[], source: string): PmNode[] {
  const out: PmNode[] = [];
  const push = (node: PhrasingContent, marks: readonly Mark[]) => {
    switch (node.type) {
      case "text":
        if (node.value !== "") out.push(schema.text(node.value, marks));
        return;
      case "strong":
        node.children.forEach((c) => push(c, [...marks, schema.marks.strong.create()]));
        return;
      case "emphasis":
        node.children.forEach((c) => push(c, [...marks, schema.marks.em.create()]));
        return;
      case "delete":
        node.children.forEach((c) => push(c, [...marks, schema.marks.strike.create()]));
        return;
      case "link":
        node.children.forEach((c) =>
          push(c, [
            ...marks,
            schema.marks.link.create({ href: node.url, title: node.title ?? null }),
          ]),
        );
        return;
      case "inlineCode":
        out.push(schema.text(node.value, [...marks, schema.marks.code.create()]));
        return;
      case "image":
        out.push(
          schema.nodes.image.create({
            src: node.url,
            alt: node.alt ?? "",
            title: node.title ?? null,
          }),
        );
        return;
      case "break":
        out.push(schema.nodes.hardBreak.create());
        return;
      default:
        out.push(schema.nodes.rawInline.create({ value: slice(node, source) }));
    }
  };
  nodes.forEach((node) => push(node, []));
  return out;
}

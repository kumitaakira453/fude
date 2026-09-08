import { Fragment, type Mark, type Node as PmNode } from "prosemirror-model";
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
//
// ノードを作るのと同時に、原文のどこから来たかを同じ形の木（Span）で残す。
// 保存のときはこれを頼りに、書き換わったところだけを原文へ差し込む。

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(remarkMath);

// 直列化した結果を読み直して確かめる側からも使う。
export const parseTree = (text: string): Root => processor.parse(text) as Root;

// ノードと同じ形をした、原文の範囲の木。children はノードの子と 1 対 1。
export interface Span {
  start: number;
  end: number;
  children: Span[];
}

export interface Loaded {
  doc: PmNode;
  // frontmatter を除いた本文。範囲はこの文字列の上の位置。
  source: string;
  ranges: Map<string, [number, number]>;
  originals: Map<string, PmNode>;
  spans: Map<string, Span>;
}

interface Built {
  node: PmNode;
  span: Span;
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
// 実データの表 3,848 個のうち桁が揃っているのは 76 個だけで、3,333 個は
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
  const spans = new Map<string, Span>();
  const blocks: PmNode[] = [];
  let seq = 0;

  for (const g of group(parseTree(source).children, source)) {
    const id = `b${seq++}`;
    const built = nodeOf(g, source, 0, id);
    if (!built) continue;
    ranges.set(id, [built.span.start, built.span.end]);
    originals.set(id, built.node);
    spans.set(id, built.span);
    blocks.push(built.node);
  }

  const doc = schema.nodes.doc.create(null, blocks.length ? blocks : [empty().node]);
  return { doc, source, ranges, originals, spans };
}

const span = (start: number, end: number, children: Span[] = []): Span => ({
  start,
  end,
  children,
});

const empty = (at = 0): Built => ({ node: schema.nodes.paragraph.create(), span: span(at, at) });

function nodeOf(g: Group, source: string, base: number, id: string | null): Built | null {
  const attrs = id ? { id } : {};
  if (g.kind === "plain") return blockOf(g.node!, source, base, id);

  const inner = blocksOfText(source.slice(g.innerStart!, g.innerEnd!), base + g.innerStart!);
  const at = span(base + g.start, base + g.end, inner.spans);
  if (g.kind === "details") {
    return { node: schema.nodes.details.create({ ...attrs, head: g.head }, inner.nodes), span: at };
  }
  return {
    node: schema.nodes.callout.create(
      {
        ...attrs,
        icon: attrOf(g.attrs ?? "", "icon"),
        color: attrOf(g.attrs ?? "", "color") || null,
      },
      inner.nodes,
    ),
    span: at,
  };
}

interface Blocks {
  nodes: PmNode[];
  spans: Span[];
}

// 囲みの中身は文字列から読み直す。入れ子も同じ道を通る。
function blocksOfText(text: string, base: number): Blocks {
  return collect(group(parseTree(text).children, text), text, base);
}

function blocksOf(nodes: RootContent[], source: string, base: number): Blocks {
  return collect(group(nodes, source), source, base);
}

function collect(groups: Group[], source: string, base: number): Blocks {
  const out: Blocks = { nodes: [], spans: [] };
  for (const g of groups) {
    const built = nodeOf(g, source, base, null);
    if (!built) continue;
    out.nodes.push(built.node);
    out.spans.push(built.span);
  }
  if (out.nodes.length) return out;
  const blank = empty(base);
  return { nodes: [blank.node], spans: [blank.span] };
}

const slice = (node: RootContent | PhrasingContent, source: string): string =>
  source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);

const at = (node: RootContent | PhrasingContent, base: number): [number, number] => [
  base + (node.position?.start.offset ?? 0),
  base + (node.position?.end.offset ?? 0),
];

function blockOf(
  node: RootContent,
  source: string,
  base: number,
  id: string | null,
): Built | null {
  const attrs = id ? { id } : {};
  const [start, end] = at(node, base);

  switch (node.type) {
    case "paragraph": {
      const inline = inlineOf(node.children, source, base);
      return {
        node: schema.nodes.paragraph.create(attrs, inline.nodes),
        span: span(start, end, inline.spans),
      };
    }

    case "heading": {
      const inline = inlineOf(node.children, source, base);
      return {
        node: schema.nodes.heading.create({ ...attrs, level: node.depth }, inline.nodes),
        span: span(start, end, inline.spans),
      };
    }

    case "blockquote": {
      const inner = blocksOf(node.children, source, base);
      return {
        node: schema.nodes.blockquote.create(attrs, inner.nodes),
        span: span(start, end, inner.spans),
      };
    }

    case "code": {
      const src = slice(node, source);
      const fence = /^\s*(`{3,}|~{3,})/.exec(src)?.[1] ?? null;
      const text = node.value === "" ? [] : [schema.text(node.value)];
      // 中身が原文にそのまま現れていれば、その位置を覚える。字下げのコードは
      // 行頭の空白が中身から落ちていて見つからないので、丸ごと組み直しになる。
      const from = node.value === "" ? -1 : src.indexOf(node.value);
      return {
        node: schema.nodes.codeBlock.create(
          { ...attrs, lang: node.lang ?? null, fenced: fence !== null, fence: fence ?? "```" },
          text,
        ),
        span: span(
          start,
          end,
          node.value === ""
            ? []
            : from < 0
              ? // 字下げのコードは行頭の空白が中身から落ちていて見つからない。
                // 範囲は塊のまま渡し、対応づけ側で空白を読み飛ばす。
                [span(start, end)]
              : [span(start + from, start + from + node.value.length)],
        ),
      };
    }

    case "list": {
      const src = slice(node, source);
      const items: PmNode[] = [];
      const itemSpans: Span[] = [];
      for (const item of node.children) {
        const inner = blocksOf(item.children, source, base);
        const [s, e] = at(item, base);
        items.push(
          schema.nodes.listItem.create({ checked: item.checked ?? null }, inner.nodes),
        );
        itemSpans.push(span(s, e, inner.spans));
      }
      const tight = !node.spread;
      if (node.ordered) {
        const marker = /^\s*\d+([.)])/.exec(src)?.[1] ?? ".";
        return {
          node: schema.nodes.orderedList.create(
            { ...attrs, tight, start: node.start ?? 1, marker },
            items,
          ),
          span: span(start, end, itemSpans),
        };
      }
      const marker = /^\s*([-*+])/.exec(src)?.[1] ?? "-";
      return {
        node: schema.nodes.bulletList.create({ ...attrs, tight, marker }, items),
        span: span(start, end, itemSpans),
      };
    }

    case "table": {
      const { widths, delim } = tableStyle(slice(node, source));
      const rows: PmNode[] = [];
      const rowSpans: Span[] = [];
      node.children.forEach((row, r) => {
        const cells: PmNode[] = [];
        const cellSpans: Span[] = [];
        for (const cell of row.children) {
          const inline = inlineOf(cell.children, source, base);
          const [s, e] = at(cell, base);
          cells.push(schema.nodes.tableCell.create({ header: r === 0 }, inline.nodes));
          cellSpans.push(span(s, e, inline.spans));
        }
        const [s, e] = at(row, base);
        rows.push(schema.nodes.tableRow.create(null, cells));
        rowSpans.push(span(s, e, cellSpans));
      });
      return {
        node: schema.nodes.table.create({ ...attrs, align: node.align ?? [], widths, delim }, rows),
        span: span(start, end, rowSpans),
      };
    }

    case "math":
      // 中身と、原文の書き方の両方を持つ。打ち直さないかぎり原文で戻す。
      return {
        node: schema.nodes.mathBlock.create({
          ...attrs,
          tex: node.value,
          raw: slice(node, source),
        }),
        span: span(start, end),
      };

    case "thematicBreak":
      return {
        node: schema.nodes.thematicBreak.create({ ...attrs, marker: slice(node, source).trim() }),
        span: span(start, end),
      };

    default:
      // 生 HTML・定義・脚注・数式など。構造化せず原文のまま持つ。
      return {
        node: schema.nodes.rawBlock.create({ ...attrs, value: slice(node, source) }),
        span: span(start, end),
      };
  }
}

interface Inline {
  nodes: PmNode[];
  spans: Span[];
}

// ---- 下線 ----

const isTag = (node: PmNode, tag: string): boolean =>
  node.type === schema.nodes.rawInline && node.attrs.value === tag;

// 釣り合う </u> の位置。無ければ -1。入れ子は数えない（実データに無い）。
function closeU(nodes: PmNode[], from: number): number {
  for (let i = from + 1; i < nodes.length; i++) {
    if (isTag(nodes[i], "<u>")) return -1;
    if (isTag(nodes[i], "</u>")) return i;
  }
  return -1;
}

// <u>…</u> を下線の印へ畳む。
//
// Markdown に下線の記号は無いので、実データは生の <u> で書かれている。素の
// まま持つと編集面にタグの字がそのまま出て、押しても外せない。
//
// 畳んだ結果、同じ印の字が隣り合うと ProseMirror が 1 つの字へ束ねる
// （`<u>あ</u><u>い</u>` のように装飾の無い字が続くとき）。数が合わないと
// 原文の範囲との対応が崩れて保存が壊れるので、そのときは畳まずに戻す。
function foldUnderline(inline: Inline): Inline {
  if (!inline.nodes.some((node) => isTag(node, "<u>"))) return inline;
  const mark = schema.marks.underline.create();
  const out: Inline = { nodes: [], spans: [] };

  for (let i = 0; i < inline.nodes.length; i++) {
    const close = isTag(inline.nodes[i], "<u>") ? closeU(inline.nodes, i) : -1;
    // 中身の無い対（`<u></u>`）は畳むと字ごと消えるので、原文のまま持つ。
    if (close < 0 || close === i + 1) {
      out.nodes.push(inline.nodes[i]);
      out.spans.push(inline.spans[i]);
      continue;
    }
    for (let j = i + 1; j < close; j++) {
      out.nodes.push(inline.nodes[j].mark(mark.addToSet(inline.nodes[j].marks)));
      out.spans.push(inline.spans[j]);
    }
    i = close;
  }

  return Fragment.fromArray(out.nodes).childCount === out.nodes.length ? out : inline;
}

function inlineOf(nodes: PhrasingContent[], source: string, base: number): Inline {
  const out: Inline = { nodes: [], spans: [] };
  const push = (node: PhrasingContent, marks: readonly Mark[]) => {
    const [start, end] = at(node, base);
    const add = (pm: PmNode) => {
      out.nodes.push(pm);
      out.spans.push(span(start, end));
    };
    switch (node.type) {
      case "text":
        if (node.value !== "") add(schema.text(node.value, marks));
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
      case "inlineCode": {
        // 範囲は囲みの ` を除いた中身に狭める。そうしないと、書き換えたときに
        // 囲みごと差し替わってしまう。
        const raw = source.slice(start - base, end - base);
        const from = raw.indexOf(node.value);
        const pm = schema.text(node.value, [...marks, schema.marks.code.create()]);
        out.nodes.push(pm);
        out.spans.push(
          from < 0
            ? span(start, end)
            : span(start + from, start + from + node.value.length),
        );
        return;
      }
      case "image":
        add(
          schema.nodes.image.create({
            src: node.url,
            alt: node.alt ?? "",
            title: node.title ?? null,
          }),
        );
        return;
      case "break":
        add(schema.nodes.hardBreak.create());
        return;
      case "inlineMath":
        // 中身と、原文の書き方の両方を持つ。打ち直さないかぎり原文で戻す。
        add(
          schema.nodes.inlineMath.create({
            tex: node.value,
            raw: source.slice(start - base, end - base),
          }),
        );
        return;
      default:
        add(schema.nodes.rawInline.create({ value: slice(node, source) }));
    }
  };
  nodes.forEach((node) => push(node, []));
  return foldUnderline(out);
}

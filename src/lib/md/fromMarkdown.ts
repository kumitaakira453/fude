import { Fragment, type Mark, type Node as PmNode } from "prosemirror-model";
import type { Root, RootContent, PhrasingContent } from "mdast";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { schema } from "./schema";
import { splitRow } from "../blocks";
import { boxOf, readTaskMarks } from "./taskMarks";
import {
  CONTAINERS,
  commonIndent,
  containerSpans,
  innerPad,
  lostList,
  unpadLines,
  type ContainerSpan,
} from "../htmlSpans";

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
export const parseTree = (text: string): Root => {
  const tree = processor.parse(text) as Root;
  // 字として残っている印（`- [/] `・`- [ ]` だけの行）を項目へ移す。
  readTaskMarks(tree);
  return tree;
};

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

const KINDS = CONTAINERS;

type Kind = keyof typeof KINDS;

const SUMMARY_CLOSE = "</summary>";

const attrOf = (attrs: string, name: string): string =>
  new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? "";

interface Group {
  kind: Kind | "plain" | "lost";
  node?: RootContent;
  start: number;
  end: number;
  attrs?: string;
  head?: string;
  innerStart?: number;
  innerEnd?: number;
  // 字下げを落として読み直す区間（親の項目を失った一覧）。
  text?: string;
  back?: (at: number) => number;
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

// トップレベルの囲みは、mdast に渡す前に行で範囲を決める。CommonMark に任せると
// `</details>` の後ろに空行が無い書き方で、後ろの本文まで同じ html の塊に飲まれ、
// 塊の対を取り直したときにその分が doc から落ちる。
function groupsOf(source: string): Group[] {
  const out: Group[] = [];
  let at = 0;
  for (const span of containerSpans(source)) {
    out.push(...plainGroups(source, at, span.start));
    out.push(containerGroup(span, source));
    at = span.end;
  }
  out.push(...plainGroups(source, at, source.length));
  return out;
}

// 囲みでない区間。mdast へ渡し、位置は原文のものに直す。
function plainGroups(source: string, from: number, to: number): Group[] {
  if (from >= to) return [];
  const children = parseTree(source.slice(from, to)).children;
  for (const node of children) shiftBy(node, from);

  return group(children, source).map((g) => {
    if (g.kind !== "plain" || g.node?.type !== "code") return g;
    const src = source.slice(g.start, g.end);
    if (!lostList(src)) return g;
    const cut = unpadLines(src, commonIndent(src.split("\n")));
    return cut
      ? { kind: "lost" as const, start: g.start, end: g.end, text: cut.text, back: cut.back }
      : g;
  });
}

function containerGroup(at: ContainerSpan, source: string): Group {
  const { open, close } = KINDS[at.kind];
  const first = source.slice(at.start, lineEnd(source, at.start));
  // details は開きから </summary> までを原文のまま持つ。実データの summary は
  // 複数行に割れていることが多く、組み直すと崩れる。
  let head = first;
  if (at.kind === "details") {
    const to = source.slice(at.start, at.end).indexOf(SUMMARY_CLOSE);
    if (to >= 0) head = source.slice(at.start, at.start + to + SUMMARY_CLOSE.length);
  }
  const line = source.lastIndexOf("\n", at.end - 1) + 1;
  const closeStart = source.indexOf(close, line);
  const innerEnd = closeStart < 0 ? at.end : closeStart;
  return {
    kind: at.kind,
    start: at.start,
    end: at.end,
    attrs: open.exec(first.trim())?.[1]?.trim() ?? "",
    head,
    innerStart: Math.min(at.start + head.length + 1, innerEnd),
    innerEnd,
  };
}

// 区間ごとに読んだ mdast の位置を、原文の位置へ寄せる。
function shiftBy(node: RootContent, by: number): void {
  const at = node.position;
  if (at) {
    if (at.start.offset !== undefined) at.start.offset += by;
    if (at.end.offset !== undefined) at.end.offset += by;
  }
  for (const kid of (node as { children?: RootContent[] }).children ?? []) shiftBy(kid, by);
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

  for (const g of groupsOf(source)) {
    for (const built of builtOf(g, source, 0, () => `b${seq++}`)) {
      const id = built.node.attrs.id as string | null;
      blocks.push(built.node);
      if (!id) continue;
      ranges.set(id, [built.span.start, built.span.end]);
      originals.set(id, built.node);
      spans.set(id, built.span);
    }
  }

  const doc = schema.nodes.doc.create(null, blocks.length ? blocks : [empty().node]);
  return { doc, source, ranges, originals, spans };
}

// トグルの題。開きタグの行と、<summary> の中身に分ける。
//
// 題は本文の節点として持つので、押した場所にカーソルが入り、矢印でも行き来
// できる。範囲は原文の <summary> の中身（前後の空白を除いたところ）に取る。
// 打ち直したときはそこへ差し込むだけで済み、複数行に割れた summary も形が
// 崩れない。
const SUMMARY_TAG = /<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>/;
const SUMMARY_HEADING = /^\s*<h([1-6])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>\s*$/;

function summaryOf(g: Group, base: number): Built & { head: string } {
  const head = g.head ?? "<details>";
  const open = head.slice(0, lineEnd(head, 0));
  const found = SUMMARY_TAG.exec(head);
  if (!found) {
    const at = base + g.start + open.length;
    return {
      head: open,
      node: schema.nodes.detailsSummary.create(),
      span: span(at, at),
    };
  }

  // <summary> の中身の位置（head の中での位置 → 原文の位置）
  const tag = found[0].slice(0, found[0].indexOf(">") + 1);
  let from = found.index + tag.length;
  let text = found[1];
  let level: number | null = null;

  const heading = SUMMARY_HEADING.exec(text);
  if (heading) {
    level = Number(heading[1]);
    const inner = heading[2];
    from += text.indexOf(inner, text.indexOf(">") + 1);
    text = inner;
  }
  // 前後の空白は原文に残す（複数行の summary をそのまま保つ）。
  const lead = text.length - text.trimStart().length;
  from += lead;
  text = text.trim();

  const at = base + g.start + from;
  const inline = titleInline(text, at);
  return {
    head: open,
    node: schema.nodes.detailsSummary.create({ level }, inline.nodes),
    span: span(at, at + text.length, inline.spans),
  };
}

// 題の字も行内の印が効く。単独の markdown として読み直し、1 つの段落に
// なったときだけその中身を使う（項目や見出しになる字は素の字のまま）。
function titleInline(text: string, at: number): Inline {
  if (!text) return { nodes: [], spans: [] };
  const tree = parseTree(text);
  const first = tree.children.length === 1 ? tree.children[0] : null;
  if (first?.type !== "paragraph") {
    return { nodes: [schema.text(text)], spans: [span(at, at + text.length)] };
  }
  return inlineOf(first.children, text, at);
}

const span = (start: number, end: number, children: Span[] = []): Span => ({
  start,
  end,
  children,
});

const empty = (at = 0): Built => ({ node: schema.nodes.paragraph.create(), span: span(at, at) });

// 1 つの塊から生まれるブロック。字下げを落として読み直した区間だけ複数になる。
function builtOf(
  g: Group,
  source: string,
  base: number,
  nextId: () => string | null,
): Built[] {
  if (g.kind !== "lost") {
    const one = nodeOf(g, source, base, nextId());
    return one ? [one] : [];
  }
  const inner = blocksOfText(g.text!, 0);
  // 落とした後の位置 → この文字列の中の位置 → base を足して本文の位置。
  const local = (o: number) => g.start + g.back!(o);
  // ブロックの範囲は行の頭から。原文の字下げごと持たせないと、触っていない
  // ブロックを原文から出すときに行頭が欠ける。
  const lineHead = (o: number) => base + source.lastIndexOf("\n", local(o) - 1) + 1;
  return inner.nodes.map((node, i) => {
    const at = moveSpan(inner.spans[i], (o) => base + local(o));
    return {
      node: withId(node, nextId()),
      span: { ...at, start: lineHead(inner.spans[i].start) },
    };
  });
}

const withId = (node: PmNode, id: string | null): PmNode =>
  id && node.type.spec.attrs && "id" in node.type.spec.attrs
    ? node.type.create({ ...node.attrs, id }, node.content, node.marks)
    : node;

function nodeOf(g: Group, source: string, base: number, id: string | null): Built | null {
  const attrs = id ? { id } : {};
  if (g.kind === "plain") return blockOf(g.node!, source, base, id);

  const body = source.slice(g.innerStart!, g.innerEnd!);
  const inner = innerBlocks(
    body,
    base + g.innerStart!,
    innerPad(body.split("\n"), padOf(source, g.start)),
  );
  if (g.kind === "details") {
    const title = summaryOf(g, base);
    return {
      node: schema.nodes.details.create({ ...attrs, head: title.head }, [
        title.node,
        ...inner.nodes,
      ]),
      span: span(base + g.start, base + g.end, [title.span, ...inner.spans]),
    };
  }
  const at = span(base + g.start, base + g.end, inner.spans);
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
  return collect(groupsOf(text), text, base);
}

// 箇条書きの項目の中に書かれた囲みは、中身の行も項目の分だけ字下げされている。
// そのまま読み直すと字下げ 4 で字下げのコードになるので、囲みが立っている桁だけ
// 落として読む。落とした分は位置に足し戻す（指摘の居場所は原文の位置で持つ）。
function innerBlocks(text: string, base: number, pad: string): Blocks {
  const cut = unpadLines(text, pad);
  if (!cut) return blocksOfText(text, base);
  const inner = blocksOfText(cut.text, 0);
  return {
    nodes: inner.nodes,
    spans: inner.spans.map((s) => moveSpan(s, (at) => base + cut.back(at))),
  };
}

const moveSpan = (s: Span, f: (at: number) => number): Span => ({
  start: f(s.start),
  end: f(s.end),
  children: s.children.map((k) => moveSpan(k, f)),
});


// 囲みが立っている桁。開きタグより前が空白だけのときに限る。
function padOf(source: string, at: number): string {
  const head = source.slice(source.lastIndexOf("\n", at - 1) + 1, at);
  return head.trim() === "" ? head : "";
}

function blocksOf(nodes: RootContent[], source: string, base: number): Blocks {
  return collect(group(nodes, source), source, base);
}

function collect(groups: Group[], source: string, base: number): Blocks {
  const out: Blocks = { nodes: [], spans: [] };
  for (const g of groups) {
    for (const built of builtOf(g, source, base, () => null)) {
      out.nodes.push(built.node);
      out.spans.push(built.span);
    }
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
      // 絵だけの段落は塊として持つ。段落のままだと、絵を塊のように描いている
      // ぶん「絵の下の行」に見える位置が段落の中にでき、カーソルも Backspace も
      // 見た目と食い違う。原文へ戻すときに段落へ包み直す。
      const only = inline.nodes.length === 1 ? inline.nodes[0] : null;
      if (only?.type === schema.nodes.image) {
        return {
          node: schema.nodes.imageBlock.create({ ...attrs, ...only.attrs }),
          span: span(start, end),
        };
      }
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
        const [s, e] = at(item, base);
        // 印は readTaskMarks が項目へ移してある。中身の無いタスク項目
        // （`- [ ]` だけの行）も、GFM では字として読まれるのでそこで拾う。
        const box = boxOf(item);
        const inner = blocksOf(item.children, source, base);
        // 印だけの項目は中身が空になる。空の項目は持てないので段落を 1 つ置く。
        const full = inner.nodes.length > 0;
        items.push(
          schema.nodes.listItem.create(
            { box },
            full ? inner.nodes : [schema.nodes.paragraph.create()],
          ),
        );
        itemSpans.push(span(s, e, full ? inner.spans : [span(s, e)]));
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
        // 段落の途中の改行は空白 1 つ。編集面は pre-wrap なので、\n のままだと
        // 原文に無い改行として描かれる。字数は変わらないので原文との対応は
        // ずれない。行末の空白 2 つや \ で終わる行は break 節点になる（下）。
        if (node.value !== "") add(schema.text(node.value.replace(/\n/g, " "), marks));
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

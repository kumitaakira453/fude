import { Fragment, type Node as PmNode } from "prosemirror-model";
import { fromMarkdown, type Loaded, type Span } from "./fromMarkdown";
import { schema } from "./schema";
import { toMarkdown } from "./toMarkdown";

// 外で書き換わった本文を、変わったところだけ読み直す。
//
// 全体の読み直しは大きいファイルで 350ms かかる（929 ブロックで実測）。
// `Loaded` はブロックごとに原文の範囲を持っているので、前後の変わっていない
// ブロックはそのまま使い回し、間だけを読み直せる。
//
// 当てにならない形（囲みの途中で切れる、ブロックが繋がる / 割れる）は最後に
// 突き合わせて弾き、全体の読み直しへ落とす。組み直した結果が新しい原文と
// 一致しなければ null を返す。

// これ未満は全体を読み直しても数 ms で終わる。手間に見合わない。
const BIG = 20_000;

export interface Reloaded {
  loaded: Loaded;
  doc: PmNode;
  // 差し替える doc の範囲と中身。
  from: number;
  to: number;
  content: Fragment;
}

interface Slot {
  node: PmNode;
  id: string;
  start: number;
  end: number;
  pos: number;
}

// 読み直した分に付ける目印。前後の使い回しとぶつからないようにする。
let gen = 0;

function slotsOf(loaded: Loaded): Slot[] | null {
  const out: Slot[] = [];
  let whole = true;
  loaded.doc.forEach((node, pos) => {
    const id = node.attrs.id as string | null;
    const range = id ? loaded.ranges.get(id) : undefined;
    if (!id || !range) {
      whole = false;
      return;
    }
    out.push({ node, id, start: range[0], end: range[1], pos });
  });
  return whole && out.length ? out : null;
}

const move = (span: Span, by: number): Span => ({
  start: span.start + by,
  end: span.end + by,
  children: span.children.map((child) => move(child, by)),
});

// 目印を付け替える。doc の節点と、突き合わせ用に控えた節点の両方を揃える。
const rekey = (node: PmNode, id: string): PmNode =>
  node.type.create({ ...node.attrs, id }, node.content, node.marks);

export function reload(old: Loaded, next: string): Reloaded | null {
  if (next === old.source) return null;
  if (next.length < BIG && old.source.length < BIG) return null;

  const slots = slotsOf(old);
  if (!slots) return null;

  const delta = next.length - old.source.length;

  // 先頭から、原文がそのまま一致しているブロックの数。
  //
  // 境目はブロックの端ではなく「次のブロックの頭」で見る。端で見ると、同じ
  // ブロックの中で後ろへ伸びた変更を「変わっていない」と取り違える
  // （"# 題" → "# 題を直した" の先頭 3 文字は一致してしまう）。
  let head = 0;
  while (head < slots.length) {
    const edge = head + 1 < slots.length ? slots[head + 1].start : old.source.length;
    if (next.length < edge) break;
    if (next.slice(0, edge) !== old.source.slice(0, edge)) break;
    head++;
  }

  // 末尾から、原文がそのまま一致しているブロックの数。境目は同じ理由で
  // 「前のブロックの終わり」で見る。
  let tail = 0;
  while (tail < slots.length - head) {
    const i = slots.length - 1 - tail;
    const edge = i > 0 ? slots[i - 1].end : 0;
    const at = edge + delta;
    if (at < 0 || at > next.length) break;
    if (next.slice(at) !== old.source.slice(edge)) break;
    tail++;
  }
  if (tail >= slots.length) return null;

  // 読み直す原文の範囲。前後はブロックの境界まで広げてある。
  const iTail = slots.length - tail;
  const fromSrc = head > 0 ? slots[head - 1].end : 0;
  const toSrc = tail > 0 ? slots[iTail - 1].end + delta : next.length;
  if (toSrc < fromSrc) return null;

  const cut = next.slice(fromSrc, toSrc);
  const mark = `r${gen++}`;

  const nodes: PmNode[] = [];
  const middle: PmNode[] = [];
  const ranges = new Map<string, [number, number]>();
  const originals = new Map<string, PmNode>();
  const spans = new Map<string, Span>();

  const carry = (slot: Slot, by: number) => {
    const span = old.spans.get(slot.id);
    const original = old.originals.get(slot.id);
    if (!span || !original) return false;
    nodes.push(slot.node);
    ranges.set(slot.id, [slot.start + by, slot.end + by]);
    spans.set(slot.id, by === 0 ? span : move(span, by));
    originals.set(slot.id, original);
    return true;
  };

  for (let i = 0; i < head; i++) {
    if (!carry(slots[i], 0)) return null;
  }

  // 間が空白だけなら、ブロックは無い（前後のあいだの空行として原文から出る）。
  if (cut.trim()) {
    const mid = fromMarkdown(cut);
    let broken = false;
    mid.doc.forEach((node) => {
      const was = node.attrs.id as string | null;
      const range = was ? mid.ranges.get(was) : undefined;
      const span = was ? mid.spans.get(was) : undefined;
      const original = was ? mid.originals.get(was) : undefined;
      if (!was || !range || !span || !original) {
        broken = true;
        return;
      }
      const id = `${mark}-${was}`;
      const fixed = rekey(node, id);
      nodes.push(fixed);
      middle.push(fixed);
      ranges.set(id, [range[0] + fromSrc, range[1] + fromSrc]);
      spans.set(id, move(span, fromSrc));
      originals.set(id, rekey(original, id));
    });
    if (broken) return null;
  }

  for (let i = iTail; i < slots.length; i++) {
    if (!carry(slots[i], delta)) return null;
  }

  const doc = schema.nodes.doc.create(
    null,
    nodes.length ? nodes : [schema.nodes.paragraph.create()],
  );
  const loaded: Loaded = { doc, source: next, ranges, originals, spans };

  // 組み直した結果が新しい原文に戻るか。戻らなければ切り方が悪い
  // （ブロックが繋がった / 割れた）ので、全体の読み直しへ落とす。
  if (toMarkdown(doc, loaded) !== next) return null;

  const from = head > 0 ? slots[head - 1].pos + slots[head - 1].node.nodeSize : 0;
  const to = tail > 0 ? slots[iTail].pos : old.doc.content.size;
  if (to < from) return null;

  return { loaded, doc, from, to, content: Fragment.from(middle) };
}

import { Fragment, type Attrs, type Node as PmNode, type NodeType } from "prosemirror-model";
import { Selection, type EditorState, type Transaction } from "prosemirror-state";
import { schema } from "./schema";

// 箇条書きを「項目の列」として扱う。
//
// 入れ子は節点の階層で表されているので、掴んだ項目を別の階層へ落とすには
// 木を組み直すことになる。列に開いてから並べ替え、深さの列から組み直す。
// 画面を作らずに試せるよう、純粋な関数だけで置く。

export interface Flat {
  // その項目。入れ子の並びは外してある（深さが代わりに持つ）。
  item: PmNode;
  // 0 がいちばん外。
  depth: number;
  // 入っていた並びの形。組み直すときに使う。
  listType: NodeType;
  listAttrs: Attrs;
}

const isList = (node: PmNode): boolean =>
  node.type === schema.nodes.bulletList || node.type === schema.nodes.orderedList;

// 並びを項目の列に開く。並ぶ順は本文に出てくる順。
export function flatten(list: PmNode): Flat[] {
  const out: Flat[] = [];
  const walk = (node: PmNode, depth: number) => {
    node.forEach((item) => {
      const body: PmNode[] = [];
      const nests: PmNode[] = [];
      item.forEach((child) => (isList(child) ? nests : body).push(child));
      // 中身が入れ子だけの項目もある。空の項目は置けないので行を 1 つ残す。
      if (body.length === 0) body.push(schema.nodes.paragraph.create());
      out.push({
        item: item.type.create(item.attrs, Fragment.fromArray(body)),
        depth,
        listType: node.type,
        listAttrs: node.attrs,
      });
      for (const nest of nests) walk(nest, depth + 1);
    });
  };
  walk(list, 0);
  return out;
}

// 深さの飛びをならす。1 段目より浅くはならず、前より 2 段以上深くもならない。
function evened(flat: Flat[]): number[] {
  const out: number[] = [];
  let last = -1;
  for (const one of flat) {
    const depth = Math.max(0, Math.min(one.depth, last + 1));
    out.push(depth);
    last = depth;
  }
  return out;
}

// 深さの列から並びの中身を組み直す。
export function rebuild(flat: Flat[]): PmNode[] {
  const depths = evened(flat);
  let i = 0;
  const take = (depth: number): PmNode[] => {
    const items: PmNode[] = [];
    while (i < flat.length && depths[i] === depth) {
      const cur = flat[i];
      i++;
      const nests: PmNode[] = [];
      while (i < flat.length && depths[i] > depth) {
        const inner = flat[i];
        const kids = take(depth + 1);
        // 組み直した並びは原文の控えを引き継がない。階層が変わっているので、
        // 元の行をそのまま出すと書き戻りが合わない。
        nests.push(
          inner.listType.create({ ...inner.listAttrs, id: null }, Fragment.fromArray(kids)),
        );
      }
      items.push(
        cur.item.type.create(cur.item.attrs, cur.item.content.append(Fragment.fromArray(nests))),
      );
    }
    return items;
  };
  return take(0);
}

// 掴んだ項目が連れていく範囲（自分と、その下にぶら下がる項目）。
function subtree(flat: Flat[], from: number): number {
  let end = from + 1;
  while (end < flat.length && flat[end].depth > flat[from].depth) end++;
  return end;
}

// 掴んだ範囲を抜いたあとの、落とし先の位置。
function landing(flat: Flat[], from: number, slot: number): number {
  const end = subtree(flat, from);
  return slot > from ? slot - (end - from) : slot;
}

// この隙間に置ける深さの幅。
//
// 上の項目より 2 段以上深くはできず、下の項目より浅くすると、その項目を
// 巻き込んで自分の子にしてしまう。落とせる範囲をここで決め、指の横位置は
// その中に収める。
export function depthRange(
  flat: Flat[],
  from: number,
  slot: number,
): { min: number; max: number } {
  const end = subtree(flat, from);
  const rest = [...flat.slice(0, from), ...flat.slice(end)];
  const at = landing(flat, from, slot);
  const above = at > 0 ? rest[at - 1].depth : -1;
  const below = at < rest.length ? rest[at].depth : 0;
  const max = Math.max(0, above + 1);
  return { min: Math.max(0, Math.min(below, max)), max };
}

// 何番目の項目か（本文に出てくる順）。
export function itemIndexOf(list: PmNode, listPos: number, itemPos: number): number | null {
  let n = 0;
  let found: number | null = null;
  list.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type !== schema.nodes.listItem) return true;
    if (listPos + 1 + pos === itemPos) found = n;
    n++;
    return true;
  });
  return found;
}

function posOfNth(list: PmNode, listPos: number, n: number): number | null {
  let seen = 0;
  let found: number | null = null;
  list.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type !== schema.nodes.listItem) return true;
    if (seen++ === n) found = listPos + 1 + pos;
    return true;
  });
  return found;
}

// 掴んだ項目を、隙間 slot の深さ depth へ落とす。子は連れていく。
export function itemDropTr(
  state: EditorState,
  listPos: number,
  from: number,
  slot: number,
  depth: number,
): Transaction | null {
  const list = state.doc.nodeAt(listPos);
  if (!list || !isList(list)) return null;
  const flat = flatten(list);
  if (from < 0 || from >= flat.length) return null;
  if (slot < 0 || slot > flat.length) return null;

  const end = subtree(flat, from);
  // 自分の中へは落とせない。動かないなら深さが変わるときだけ効かせる。
  if (slot > from && slot < end) return null;
  const run = flat.slice(from, end);
  const shift = depth - run[0].depth;
  if (shift === 0 && (slot === from || slot === end)) return null;

  const rest = [...flat.slice(0, from), ...flat.slice(end)];
  const at = landing(flat, from, slot);
  rest.splice(at, 0, ...run.map((one) => ({ ...one, depth: one.depth + shift })));

  const items = rebuild(rest);
  if (items.length === 0) return null;
  // 並びごと組み直すので、原文の控えは落とす。
  const next = list.type.create({ ...list.attrs, id: null }, Fragment.fromArray(items));
  const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, next);
  const landed = posOfNth(next, listPos, at);
  if (landed !== null) {
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(landed + 2, tr.doc.content.size))));
  }
  return tr.scrollIntoView();
}

import { Fragment, type Attrs, type Node as PmNode, type NodeType } from "prosemirror-model";
import { Selection, type EditorState, type Transaction } from "prosemirror-state";
import { canJoin } from "prosemirror-transform";
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

export const isList = (node: PmNode): boolean =>
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

// 並びどうしが隣り合ったら一つに繋ぐ。原文では空行を挟んでも一つの並びとして
// 読み直されるので、節点を分けたままにすると書いている間だけ割れて見える。
function mergeAt(tr: Transaction, at: number): void {
  const $at = tr.doc.resolve(at);
  const before = $at.nodeBefore;
  const after = $at.nodeAfter;
  if (!before || !after || before.type !== after.type) return;
  if (!isList(before) || !canJoin(tr.doc, at)) return;
  tr.join(at);
}

// 掴んだ項目を、並びの外（塊の境目）へ出す。子は連れていく。
//
// `at` は出す先の位置。トグルの中の境目もそのまま指せる。出したものは点のまま、
// その場に 1 つの並びとして置く。隣が同じ種類の並びならそこへ繋ぐ。元の並びが
// 空になったら丸ごと消す。
export function itemOutTr(
  state: EditorState,
  listPos: number,
  from: number,
  at: number,
): Transaction | null {
  const list = state.doc.nodeAt(listPos);
  if (!list || !isList(list)) return null;
  const flat = flatten(list);
  if (from < 0 || from >= flat.length) return null;
  if (at < 0 || at > state.doc.content.size) return null;
  // 並びの中へは出さない（そこは itemDropTr の持ち場）。
  if (at > listPos && at < listPos + list.nodeSize) return null;

  const end = subtree(flat, from);
  const run = flat.slice(from, end);
  const rest = [...flat.slice(0, from), ...flat.slice(end)];
  // 元の場所の前後へ出すだけなら、並びの中での動き（itemDropTr）に譲る。
  if (rest.length > 0 && (at === listPos || at === listPos + list.nodeSize)) return null;

  const shift = -run[0].depth;
  const moved = rebuild(run.map((one) => ({ ...one, depth: one.depth + shift })));
  if (moved.length === 0) return null;
  const taken = run[0].listType.create(
    { ...run[0].listAttrs, id: null },
    Fragment.fromArray(moved),
  );

  const tr = state.tr;
  const kept = rest.length > 0 ? rebuild(rest) : [];
  if (kept.length > 0) {
    tr.replaceWith(
      listPos,
      listPos + list.nodeSize,
      list.type.create({ ...list.attrs, id: null }, Fragment.fromArray(kept)),
    );
  } else {
    tr.delete(listPos, listPos + list.nodeSize);
  }

  // 元の並びを抜いた分だけ、出す先の位置もずれる。
  const dest = tr.mapping.map(at);
  const $dest = tr.doc.resolve(dest);
  if (!$dest.parent.canReplaceWith($dest.index(), $dest.index(), taken.type)) return null;
  tr.insert(dest, taken);
  mergeAt(tr, dest + taken.nodeSize);
  mergeAt(tr, dest);
  const landed = tr.doc.resolve(Math.min(dest + 2, tr.doc.content.size));
  return tr.setSelection(Selection.near(landed)).scrollIntoView();
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

// 前の兄弟がトグルだけの項目（`- <details>`）なら、項目をそのトグルの中身の
// 末尾へ移す（Tab）。項目ごと沈めると、トグルの外にトグルの項目の子ができ、
// Notion にその形は無い（Notion ではトグルの下へ字下げするとトグルの中に入る）。
// 当てはまらなければ null（いつもの字下げに任せる）。
export function itemIntoToggleTr(state: EditorState): Transaction | null {
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type !== schema.nodes.listItem) depth--;
  if (depth === 0) return null;
  const at = $from.index(depth - 1);
  if (at === 0) return null;
  const list = $from.node(depth - 1);
  const prev = list.child(at - 1);
  const toggle = prev.firstChild;
  if (!toggle || toggle.type !== schema.nodes.details) return null;

  const item = $from.node(depth);
  const itemStart = $from.before(depth);
  // トグルの中身の終わり（</details> の手前）。前の項目の頭の 1 つ内側がトグル。
  const prevStart = itemStart - prev.nodeSize;
  const inside = prevStart + 1 + toggle.nodeSize - 1;
  const last = toggle.lastChild;
  const tr = state.tr.delete(itemStart, $from.after(depth));
  let start: number;
  if (last && last.type === list.type) {
    // 中身の最後が同じ種類の箇条書きなら、その末尾に足す。
    start = inside - 1;
    tr.insert(start, item);
  } else {
    tr.insert(inside, list.type.create(list.attrs, item));
    start = inside + 1;
  }
  const pos = start + ($from.pos - itemStart);
  return tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
}

// at のトグルが項目の先頭の子なら、その項目のチェックを外す。
//
// `- <details>` の項目はその段のトグルで、チェックは持たない（原文にも書けない）。
// チェックの項目のままトグルに変えると、書く面ではチェックの右にトグルが並び、
// 保存すると印が消えて、開き直すまで見た目と原文が食い違う。
export function untickToggleItem(tr: Transaction, at: number): Transaction {
  const $at = tr.doc.resolve(at);
  const item = $at.parent;
  if (item.type !== schema.nodes.listItem || $at.index() !== 0) return tr;
  if (item.attrs.box === null) return tr;
  return tr.setNodeMarkup($at.before(), undefined, { ...item.attrs, box: null });
}

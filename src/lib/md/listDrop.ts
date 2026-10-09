import type { EditorView } from "prosemirror-view";
import { itemAtY } from "../gutterGeom";
import { isList } from "./listTree";
import { schema } from "./schema";

// 箇条書きの上へ運んだ塊（画像など）の落とし先。項目の中へ、字下げした子
// として入れる（項目の字の下に絵を置く書き方）。
//
// 並びの子は項目しか取れないので、項目と項目の「間」には入れられない。
// 指した高さの塊の上下どちらかの境目を、その項目の中の位置として返す。

export interface ItemSpot {
  pos: number;
  // 入る位置に出す線（画面の座標）。
  line: { top: number; left: number; width: number };
}

// li の DOM から、編集モデルの項目の位置。
function itemPos(view: EditorView, li: HTMLElement): number | null {
  let inside: number;
  try {
    inside = view.posAtDOM(li, 0);
  } catch {
    return null;
  }
  if (inside < 0) return null;
  const $at = view.state.doc.resolve(Math.min(inside, view.state.doc.content.size));
  for (let d = $at.depth; d > 0; d--) {
    if ($at.node(d).type === schema.nodes.listItem) return $at.before(d);
  }
  return null;
}

interface Part {
  pos: number;
  end: number;
  rect: DOMRect;
}

// 項目の中の、並び以外の塊（字の行・画像・コードなど）。入れ子の並びは、
// その中の項目が自分で受ける。
function partsOf(view: EditorView, at: number): Part[] {
  const item = view.state.doc.nodeAt(at);
  if (!item) return [];
  const parts: Part[] = [];
  let pos = at + 1;
  item.forEach((child) => {
    const el = view.nodeDOM(pos);
    if (!isList(child) && el instanceof HTMLElement) {
      parts.push({ pos, end: pos + child.nodeSize, rect: el.getBoundingClientRect() });
    }
    pos += child.nodeSize;
  });
  return parts;
}

// 指した高さにある塊。外れていれば近い方。
function partAtY(parts: Part[], y: number): number {
  let best = 0;
  let gap = Infinity;
  parts.forEach((part, i) => {
    const away = y < part.rect.top ? part.rect.top - y : y > part.rect.bottom ? y - part.rect.bottom : 0;
    if (away < gap) {
      gap = away;
      best = i;
    }
  });
  return best;
}

export function intoItem(view: EditorView, listEl: HTMLElement, y: number): ItemSpot | null {
  const li = itemAtY(listEl, y, "li");
  if (!li) return null;
  const at = itemPos(view, li);
  if (at === null) return null;
  const parts = partsOf(view, at);
  if (parts.length === 0) return null;
  const right = listEl.getBoundingClientRect().right;
  const spot = (pos: number, top: number, left: number): ItemSpot => ({
    pos,
    line: { top, left, width: Math.max(0, right - left) },
  });

  const i = partAtY(parts, y);
  const part = parts[i];
  if (y >= part.rect.top + part.rect.height / 2) {
    return spot(part.end, part.rect.bottom, part.rect.left);
  }
  if (i > 0) return spot(part.pos, part.rect.top, part.rect.left);

  // 項目の 1 行目の上半分。前の項目の末尾（子の並びの後ろ）へ入れる。前が
  // 無ければ、入れ子の並びの頭なので親の項目の 1 行目の下へ入れる。
  const prev = li.previousElementSibling;
  if (prev instanceof HTMLElement && prev.tagName === "LI") {
    const p = itemPos(view, prev);
    const node = p === null ? null : view.state.doc.nodeAt(p);
    const head = p === null ? undefined : partsOf(view, p)[0];
    if (p === null || !node || !head) return null;
    return spot(p + node.nodeSize - 1, part.rect.top, head.rect.left);
  }
  const parent = li.parentElement?.closest("li");
  if (parent instanceof HTMLElement && listEl.contains(parent)) {
    const p = itemPos(view, parent);
    const head = p === null ? undefined : partsOf(view, p)[0];
    if (!head) return null;
    return spot(head.end, part.rect.top, head.rect.left);
  }
  // いちばん外の最初の項目の上。並びの前は呼ぶ側が決める。
  return null;
}

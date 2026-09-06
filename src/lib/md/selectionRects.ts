import type { EditorView } from "prosemirror-view";

// 選んだ範囲を、字の箱の高さに揃えた矩形の並びにする。
//
// 標準の ::selection は行の箱に塗られ、その高さは line-height で決まる。
// 紙面のような行間（1.85）と字の箱（1.1em ほど）の差がそのまま余白として
// 塗られるので、字よりずっと高い帯になる。高さを決める指定は CSS に無い。
// カーソルと同じ考え方で、字の箱に合わせた矩形を自分で並べる。
//
// 測るのは DOM の文字ノードだけ。Range.getClientRects は「丸ごと入っている
// 要素の枠」も返す仕様なので、範囲をまとめて 1 つの Range で測ると段落の枠
// （行の箱の高さ＋余白）が混ざる。文字ノードごとに測れば返ってくるのは字の
// 箱だけになり、折り返しの分け方はブラウザに任せられる。

export interface Band {
  // 見えている帯。client 座標。
  top: number;
  bottom: number;
}

export interface Base {
  // 矩形を重ねる入れ物。client 座標。返す矩形はこの左上を原点にする。
  left: number;
  top: number;
  right: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// 帯の外へどれだけ余分に見るか。位置を聞く点をずらす分と、走査を打ち切る
// 手前の余裕を兼ねる。境目で 1 行落とすより、少し余分に測る方が安い。
const MARGIN = 200;

// 字が並ぶ入れ物として扱うタグ。矩形を右へ伸ばす先と、横スクロールする塊で
// はみ出しを切る先に使う。
const BLOCKS = new Set([
  "P",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
  "TD",
  "TH",
  "DT",
  "DD",
  "SUMMARY",
  "FIGCAPTION",
  "DIV",
]);

interface Box {
  left: number;
  right: number;
  // 内容の右端（余白と枠線を除いた位置）。矩形を伸ばす先。
  inner: number;
}

// 字の入れ物を辿る。編集面そのものも入れ物として扱うので、必ず見つかる。
function blockOf(from: Node, root: HTMLElement): HTMLElement {
  for (let el = from.parentElement; el; el = el.parentElement) {
    if (el === root || BLOCKS.has(el.tagName)) return el;
  }
  return root;
}

function boxOf(el: HTMLElement, kept: Map<HTMLElement, Box>): Box {
  const was = kept.get(el);
  if (was) return was;
  const rect = el.getBoundingClientRect();
  const how = getComputedStyle(el);
  const box: Box = {
    left: rect.left,
    right: rect.right,
    inner:
      rect.right -
      (parseFloat(how.paddingRight) || 0) -
      (parseFloat(how.borderRightWidth) || 0),
  };
  kept.set(el, box);
  return box;
}

// 視覚行 1 本ぶんの塗り。同じ行に来た断片を束ねていく。
interface Row {
  top: number;
  bottom: number;
  left: number;
  right: number;
  block: HTMLElement;
}

// 同じ視覚行かどうか。縦の真ん中が相手の高さに入っていれば同じ行と見なす。
// 行内コードのように字の箱の高さが違う断片も 1 本に束ねたいので、重なりの
// 有無ではなく真ん中で見る（行間を詰めた本文で隣の行と繋がるのを防ぐ）。
function sameRow(row: Row, rect: DOMRect): boolean {
  const mid = (rect.top + rect.bottom) / 2;
  if (mid > row.top && mid < row.bottom) return true;
  const was = (row.top + row.bottom) / 2;
  return was > rect.top && was < rect.bottom;
}

// 範囲の始まりにある文字ノードと、そこから先を辿る道具。
//
// 入り口を範囲の始まりへ寄せるのが肝。編集面そのものを起点にして辿ると、
// ブロックの境目から始まる選択（段落の頭を選んだとき）で本文の先頭から
// 舐め直すことになり、本文の大きさに比例して遅くなる。
function walkerFrom(root: HTMLElement, at: { node: Node; offset: number }) {
  const walk = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  if (at.node instanceof Text) {
    walk.currentNode = at.node;
    return { walk, first: at.node };
  }
  const child = at.node.childNodes[at.offset];
  walk.currentNode = child ?? at.node;
  return { walk, first: child instanceof Text ? child : walk.nextNode() };
}

export function selectionRects(
  view: EditorView,
  from: number,
  to: number,
  band: Band,
  base: Base,
): Rect[] {
  if (to <= from) return [];
  const doc = view.dom.ownerDocument;

  // 見えている範囲まで詰める。選択が数千行に渡っても、測る文字ノードを
  // 画面のぶんだけに抑える。位置を聞けない環境では詰めずに進み、矩形を
  // 帯で振り落とす側に任せる。
  const probe = (y: number): number | null => {
    try {
      return view.posAtCoords({ left: base.left + 1, top: y })?.pos ?? null;
    } catch {
      return null;
    }
  };
  let head = from;
  let tail = to;
  const above = probe(band.top - MARGIN);
  if (above !== null) head = Math.max(head, Math.min(above, to));
  const below = probe(band.bottom + MARGIN);
  if (below !== null) tail = Math.min(tail, Math.max(below, head));
  if (tail <= head) return [];

  let range: Range;
  try {
    const start = view.domAtPos(head, 1);
    const end = view.domAtPos(tail, -1);
    range = doc.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return [];
  }
  if (range.collapsed) return [];

  const rows: Row[] = [];
  const span = doc.createRange();
  const { walk, first } = walkerFrom(view.dom, {
    node: range.startContainer,
    offset: range.startOffset,
  });

  let done = false;
  for (let node = first; node && !done; node = walk.nextNode()) {
    if (!(node instanceof Text)) continue;
    span.selectNodeContents(node);
    // 範囲より後ろへ出た。文字ノードは本文の順に来るので、ここで終わり。
    if (span.compareBoundaryPoints(Range.END_TO_START, range) >= 0) break;
    // まだ範囲より前。入れ物の途中から辿り始めたときに通る。
    if (span.compareBoundaryPoints(Range.START_TO_END, range) <= 0) continue;

    const s = node === range.startContainer ? range.startOffset : 0;
    const e = node === range.endContainer ? range.endOffset : node.length;
    if (e <= s) continue;
    span.setStart(node, s);
    span.setEnd(node, e);

    const block = blockOf(node, view.dom);
    for (const rect of span.getClientRects()) {
      if (rect.height <= 0) continue;
      // 帯より下へ出たら、以降は全部その下にある。
      if (rect.top >= band.bottom + MARGIN) {
        done = true;
        break;
      }
      if (rect.bottom <= band.top || rect.top >= band.bottom) continue;
      const last = rows[rows.length - 1];
      if (last && sameRow(last, rect)) {
        last.top = Math.min(last.top, rect.top);
        last.bottom = Math.max(last.bottom, rect.bottom);
        last.left = Math.min(last.left, rect.left);
        last.right = Math.max(last.right, rect.right);
        last.block = block;
        continue;
      }
      rows.push({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        block,
      });
    }
  }

  const kept = new Map<HTMLElement, Box>();
  const out: Rect[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const box = boxOf(row.block, kept);
    // 続きがある行は、その入れ物の右端まで伸ばす。字の終わりで切ると、
    // 段落をまたいで選んだときに右側がぎざぎざに残る。最後の行は伸ばさない
    // （そこで選択が終わっているので、字のところまでで正しい）。
    const stretch = i < rows.length - 1 || tail < to;
    const right = Math.min(
      stretch ? Math.max(row.right, box.inner) : row.right,
      box.right,
      base.right,
    );
    // 横スクロールする塊（コードの塊）では、字が入れ物の外へ流れる。
    const left = Math.max(row.left, box.left, base.left);
    if (right <= left) continue;
    out.push({
      left: left - base.left,
      top: row.top - base.top,
      width: right - left,
      height: row.bottom - row.top,
    });
  }
  return out;
}

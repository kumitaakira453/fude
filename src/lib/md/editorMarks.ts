import type { EditorView } from "prosemirror-view";
import { clipRects, rangeAt, readBlockText, scrollBoxOf } from "../domText";
import { findPlain } from "../projection";
import type { ReviewThread, ReviewUnit } from "../review";
import {
  mergeRects,
  noteOf,
  relTo,
  tableClip,
  textRects,
  unitOf,
  unitRects,
  type Mark,
  type Rect,
} from "../reviewMarks";
import type { Anchored } from "./reviewAnchors";
import { schema } from "./schema";

// 編集面の印。当てた節点（Anchored）から矩形を組む。
//
// 読むときは目印（data-mg-block）でブロックを引くが、編集面の DOM は
// ProseMirror が持っていて目印を足せない。代わりに編集モデルの位置から
// 要素を引き、そこから先は読むときと同じ道具（readBlockText / findPlain /
// rangeAt / mergeRects / clipRects）を通す。見た目を 1 つに保つため。

// 節点の外枠。ブロックの入れ物をそのまま測る。
function boxOf(view: EditorView, pos: number): DOMRect | null {
  const dom = view.nodeDOM(pos);
  const el = dom instanceof HTMLElement ? dom : null;
  if (!el) return null;
  const box = el.getBoundingClientRect();
  return box.height > 0 ? box : null;
}

function elementAt(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom : null;
}

// 引き先の項目・セルの要素。編集モデルを数えて、読む側と同じ通し番号で引く
// （編集面の DOM には読む側の目印が無い）。
function unitElementIn(
  view: EditorView,
  pos: number,
  unit: ReviewUnit,
): HTMLElement | null {
  const block = view.state.doc.nodeAt(pos);
  if (!block) return null;
  const type = unit.kind === "cell" ? schema.nodes.tableCell : schema.nodes.listItem;
  let at = -1;
  let seen = 0;
  block.descendants((node, offset) => {
    if (node.type !== type) return true;
    if (seen++ === unit.index) at = pos + 1 + offset;
    return true;
  });
  return at < 0 ? null : elementAt(view, at);
}

// 覆っているブロックの箱を、その節点から順に並べる。
function boxesFrom(
  view: EditorView,
  pos: number,
  covered: number,
): DOMRect[] {
  const out: DOMRect[] = [];
  let at = pos;
  for (let i = 0; i < Math.max(1, covered); i++) {
    const node = view.state.doc.nodeAt(at);
    if (!node) break;
    const box = boxOf(view, at);
    if (box) out.push(box);
    at += node.nodeSize;
    if (at >= view.state.doc.content.size) break;
  }
  return out;
}

export function editorMarks(
  view: EditorView,
  base: DOMRect,
  anchored: Anchored[],
  threads: ReviewThread[],
): Mark[] {
  const byId = new Map(threads.map((t) => [t.id, t]));
  const out: Mark[] = [];
  for (const anchor of anchored) {
    const thread = byId.get(anchor.id);
    const el = thread ? elementAt(view, anchor.pos) : null;
    if (!thread || !el) continue;

    const bt = readBlockText(el);
    // またいだ指摘は箇所を線で示せない。覆っているブロックの枠で出す。
    const span =
      anchor.covered > 1 || !thread.selection
        ? null
        : findPlain(bt.plain, thread.selection, thread.selection_offset);
    const inner = span ? rangeAt(bt, span.start, span.end) : null;

    const boxes = boxesFrom(view, anchor.pos, anchor.covered);
    if (boxes.length === 0) continue;
    const clip = tableClip(el);
    const inBox = inner ? scrollBoxOf(inner.startContainer) : null;
    const spotClip = inBox ? inBox.getBoundingClientRect() : clip;

    const areas = clipRects(boxes, clip);
    // 項目・セルを丸ごと対象にした指摘は、その箱を箇所の印にする。中身の
    // 無い項目は選択の文字を持たないので、これが無いとブロック全体への
    // 指摘と同じ見た目になる。
    const marked =
      anchor.covered > 1 || !thread.unit
        ? null
        : unitElementIn(view, anchor.pos, thread.unit);
    const cell = marked ?? (inner ? unitOf(inner) : null);
    const spots = cell
      ? clipRects(unitRects(cell), spotClip)
      : inner
        ? clipRects(mergeRects(textRects(inner)), spotClip)
        : [];
    // 箇所が特定できているなら外枠は添えない。塗りと枠を二重に出すと、
    // どちらへの指摘なのか読み取れない。書き換わっていることは塗りの側で示す。
    const shown = spots.length === 0 ? areas : [];
    if (shown.length === 0 && spots.length === 0) continue;

    const at = spots[0] ?? areas[0];
    const last = spots[spots.length - 1] ?? areas[0];
    out.push({
      id: thread.id,
      moved: anchor.moved,
      guess: anchor.guess,
      areas: shown.map((rc) => relTo(base, rc)),
      spots: spots.map((rc) => relTo(base, rc)),
      ...noteOf(thread),
      hit: {
        id: thread.id,
        top: at.top,
        bottom: last.bottom,
        left: at.left,
      },
    });
  }
  return out;
}

// 書いている最中の対象。編集モデルの位置で持つ。
export interface EditorDraft {
  pos: number;
  // 選んだ範囲（編集モデルの位置）。ブロック丸ごとなら持たない。
  spot: { from: number; to: number } | null;
}

export function editorPending(
  view: EditorView,
  base: DOMRect,
  draft: EditorDraft,
): Rect[] {
  const el = elementAt(view, draft.pos);
  if (!el) return [];
  const clip = tableClip(el);
  if (!draft.spot) {
    const box = boxOf(view, draft.pos);
    return box ? clipRects([box], clip).map((rc) => relTo(base, rc)) : [];
  }
  const range = rangeOf(view, draft.spot.from, draft.spot.to);
  if (!range) return [];
  const cell = unitOf(range);
  const inBox = scrollBoxOf(range.startContainer);
  return clipRects(
    cell
      ? [cell.getBoundingClientRect()]
      : mergeRects(textRects(range)),
    inBox ? inBox.getBoundingClientRect() : clip,
  ).map((rc) => relTo(base, rc));
}

// 編集モデルの範囲を DOM の範囲へ。矩形を測るのはこれ経由。
function rangeOf(view: EditorView, from: number, to: number): Range | null {
  try {
    const start = view.domAtPos(from, 1);
    const end = view.domAtPos(to, -1);
    const range = view.dom.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range.collapsed ? null : range;
  } catch {
    return null;
  }
}

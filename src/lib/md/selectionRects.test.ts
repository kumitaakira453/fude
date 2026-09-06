// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { selectionRects, type Band, type Base } from "./selectionRects";

// jsdom は位置を測る道具を持たないので、字の並びを当て木で作る。
//
// 模型は「塊（段落・項目・見出し）ごとに新しい視覚行から始まり、WRAP 字で
// 折り返す」だけ。塊の中の文字ノードは、装飾で分かれていても同じ行を共有する
// （行内コードをまたいだ選択が 1 本に束ねられるかを見たいので、ここが肝）。
const CHAR = 10; // 字の幅
const TEXT = 12; // 字の箱の高さ
const LINE = 30; // 行送り。line-height に当たる
const WRAP = 10; // この字数で折り返す
const LEFT = 100; // 字が始まる位置
const RIGHT = 700; // 塊の右端
const EDGE = 80; // 重ねる入れ物の左端

const base: Base = { left: EDGE, top: 0, right: RIGHT };
const all: Band = { top: 0, bottom: 10000 };

const BLOCKS = new Set(["P", "LI", "BLOCKQUOTE", "PRE", "TD", "TH", "H1", "H2", "H3"]);

function blockOf(node: Node): Element | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (BLOCKS.has(el.tagName)) return el;
  }
  return null;
}

// 文字ノードごとの居場所。row は視覚行、col はその塊の中での字数。
const spots = new Map<Text, { row: number; col: number }>();

function layout(root: HTMLElement) {
  spots.clear();
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let block: Element | null = null;
  let row = 0;
  let col = 0;
  let free = 0;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!(n instanceof Text)) continue;
    const owner = blockOf(n);
    if (owner !== block) {
      block = owner;
      row = free;
      col = 0;
    }
    spots.set(n, { row, col });
    col += n.length;
    free = row + Math.max(1, Math.ceil(col / WRAP));
  }
}

function box(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

function listOf(rects: DOMRect[]): DOMRectList {
  const list = Object.assign([...rects], {
    item: (i: number) => rects[i] ?? null,
  });
  return list;
}

// 当て木の本体。1 つの文字ノードの中の範囲を、折り返しで割って返す。
function rectsOf(range: Range): DOMRect[] {
  const node = range.startContainer;
  if (!(node instanceof Text) || node !== range.endContainer) return [];
  const spot = spots.get(node);
  if (!spot) return [];
  const out: DOMRect[] = [];
  for (let at = range.startOffset; at < range.endOffset; ) {
    const abs = spot.col + at;
    const row = spot.row + Math.floor(abs / WRAP);
    const stop = Math.min(range.endOffset, at + (WRAP - (abs % WRAP)));
    out.push(box(LEFT + (abs % WRAP) * CHAR, row * LINE, (stop - at) * CHAR, TEXT));
    at = stop;
  }
  return out;
}

beforeEach(() => {
  Range.prototype.getClientRects = function () {
    return listOf(rectsOf(this));
  };
  Range.prototype.getBoundingClientRect = () => box(0, 0, 0, 0);
  Element.prototype.getClientRects = () => listOf([]);
  Element.prototype.getBoundingClientRect = () => box(EDGE, 0, RIGHT - EDGE, 100000);
});

let open: { view: EditorView; place: HTMLElement } | null = null;

function editor(body: string) {
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({
      doc: loaded.doc,
      plugins: editorPlugins({ onSave: () => {} }),
    }),
  });
  open = { view, place };
  layout(view.dom);
  return view;
}

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
  spots.clear();
});

// 最初の字の手前と、最後の字の直後。ブロックの入れ子で位置がずれるので数えて出す。
function head(view: EditorView): number {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText) at = pos;
    return at < 0;
  });
  return at;
}

function tail(view: EditorView): number {
  let at = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.isText) at = pos + node.nodeSize;
  });
  return at;
}

describe("選択の矩形", () => {
  it("1 行の選択は 1 本", () => {
    const view = editor("あいうえお\n");
    const rects = selectionRects(view, 1, 6, all, base);
    expect(rects).toEqual([
      { left: LEFT - EDGE, top: 0, width: 5 * CHAR, height: TEXT },
    ]);
  });

  it("高さは行送りではなく字の箱に揃う", () => {
    const view = editor("あいうえお\n");
    const rects = selectionRects(view, 1, 6, all, base);
    expect(rects[0].height).toBe(TEXT);
    expect(rects[0].height).toBeLessThan(LINE);
  });

  it("折り返しをまたぐ選択は視覚行ごとに分かれる", () => {
    // 25 字。WRAP が 10 なので 3 行に折り返る。
    const view = editor(`${"あ".repeat(25)}\n`);
    const rects = selectionRects(view, 1, 26, all, base);
    expect(rects.map((r) => r.top)).toEqual([0, LINE, 2 * LINE]);
    // 途中の行は塊の右端まで伸ばす。最後の行は字の終わりで止める。
    expect(rects.map((r) => r.width)).toEqual([
      RIGHT - LEFT,
      RIGHT - LEFT,
      5 * CHAR,
    ]);
  });

  it("複数のブロックをまたぐ選択はブロックごとに分かれる", () => {
    const view = editor("あ\n\nい\n\nう\n");
    const rects = selectionRects(view, head(view), tail(view), all, base);
    expect(rects.map((r) => r.top)).toEqual([0, LINE, 2 * LINE]);
  });

  it("箇条書きの記号のぶんは塗らない", () => {
    const view = editor("- あい\n- うえ\n");
    const rects = selectionRects(view, head(view), tail(view), all, base);
    // 字のあるところから始まる。記号のまわりに隙間ができる余地がない。
    expect(rects.every((r) => r.left === LEFT - EDGE)).toBe(true);
    expect(rects).toHaveLength(2);
  });

  it("行内コードをまたいでも 1 本に束ねる", () => {
    const view = editor("あ`い`う\n");
    // 文字ノードは 3 つに分かれるが、同じ視覚行なので 1 本になる。
    expect(view.dom.querySelector("code")).not.toBeNull();
    const rects = selectionRects(view, head(view), tail(view), all, base);
    expect(rects).toEqual([
      { left: LEFT - EDGE, top: 0, width: 3 * CHAR, height: TEXT },
    ]);
  });

  it("選択が空なら矩形を作らない", () => {
    const view = editor("あいうえお\n");
    expect(selectionRects(view, 3, 3, all, base)).toEqual([]);
    expect(selectionRects(view, 4, 3, all, base)).toEqual([]);
  });

  it("見えている範囲の外は矩形を作らない", () => {
    const view = editor("あ\n\nい\n\nう\n");
    const below: Band = { top: 500, bottom: 600 };
    expect(selectionRects(view, head(view), tail(view), below, base)).toEqual([]);
  });

  it("見えている範囲に掛かる行だけ矩形を作る", () => {
    const view = editor("あ\n\nい\n\nう\n");
    // 2 行目（top が LINE）だけが帯に掛かる。
    const band: Band = { top: LINE - 5, bottom: LINE + 5 };
    const rects = selectionRects(view, head(view), tail(view), band, base);
    expect(rects.map((r) => r.top)).toEqual([LINE]);
  });
});

// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import type { Block } from "./blocks";
import type { Resolution } from "./blockDiff";
import type { ReviewThread } from "./review";
import { readingMarks, readingPending } from "./reviewMarks";

// 印の組み立て。jsdom は描画を持たないので矩形は当て木で置き、見るのは
// 「箇所を塗るのか、枠で示すのか、そもそも出さないのか」の分かれ方。

const rects = new WeakMap<Element, DOMRect>();
const boxOf = (el: Element) => rects.get(el) ?? new DOMRect(0, 0, 0, 0);

beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return boxOf(this);
  };
  // 範囲は、その文字が入っているブロックの箱を少し内側にした 1 本とみなす。
  const ofRange = function (this: Range): DOMRect {
    const el =
      this.startContainer instanceof Element
        ? this.startContainer
        : this.startContainer.parentElement;
    const box = el ? boxOf(el) : new DOMRect(0, 0, 0, 0);
    return new DOMRect(box.left + 2, box.top + 2, Math.max(0, box.width - 4), box.height);
  };
  Range.prototype.getBoundingClientRect = ofRange;
  Range.prototype.getClientRects = function () {
    const one = ofRange.call(this);
    return [one] as unknown as DOMRectList;
  };
});

// data-mg-block を持つ入れ物と、中の段落を組む。箱は上から順に積む。
function content(...texts: string[]): HTMLElement {
  const article = document.createElement("article");
  rects.set(article, new DOMRect(0, 0, 600, 100 * texts.length));
  texts.forEach((text, i) => {
    const wrap = document.createElement("div");
    wrap.dataset.mgBlock = String(i);
    const p = document.createElement("p");
    p.textContent = text;
    rects.set(wrap, new DOMRect(0, i * 100, 600, 100));
    rects.set(p, new DOMRect(0, i * 100, 600, 100));
    wrap.appendChild(p);
    article.appendChild(wrap);
  });
  document.body.appendChild(article);
  return article;
}

const block = (index: number, src: string): Block => ({
  index,
  src,
  start: 0,
  end: src.length,
  type: "paragraph",
});

function thread(over: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "t1",
    file: "/doc.md",
    quote: "はじめの段落。",
    block_hash: "",
    selection: "はじめ",
    selection_offset: 0,
    section_path: [],
    base_version: "v1",
    status: { kind: "open" },
    comments: [{ id: "c1", author: "you", body: "ここ直して", created_at: 1 }],
    created_at: 1,
    ...over,
  };
}

const resolved = (r: Resolution) => new Map([["t1", r]]);
const base = new DOMRect(0, 0, 600, 300);

describe("readingMarks", () => {
  it("箇所が見つかれば塗りだけを出す", () => {
    const el = content("はじめの段落。", "つぎの段落。");
    const marks = readingMarks(
      el,
      base,
      [thread()],
      resolved({ state: "unchanged", index: 0, head: block(0, "はじめの段落。") }),
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].spots.length).toBeGreaterThan(0);
    expect(marks[0].areas).toHaveLength(0);
    expect(marks[0].moved).toBe(false);
    expect(marks[0].note).toBe("ここ直して");
  });

  it("書き換わっていれば枠も添える", () => {
    const el = content("はじめの段落。", "つぎの段落。");
    const marks = readingMarks(
      el,
      base,
      [thread()],
      resolved({
        state: "rewritten",
        index: 0,
        base: block(0, "はじめの段落。"),
        head: block(0, "はじめの段落。"),
      }),
    );
    expect(marks[0].moved).toBe(true);
    expect(marks[0].areas.length).toBeGreaterThan(0);
    expect(marks[0].spots.length).toBeGreaterThan(0);
  });

  it("箇所が残っていなければ枠だけを出す", () => {
    const el = content("まるごと書き換えた段落。", "つぎの段落。");
    const marks = readingMarks(
      el,
      base,
      [thread({ quote: "まるごと書き換えた段落。" })],
      resolved({
        state: "unchanged",
        index: 0,
        head: block(0, "まるごと書き換えた段落。"),
      }),
    );
    expect(marks[0].spots).toHaveLength(0);
    expect(marks[0].areas.length).toBeGreaterThan(0);
  });

  it("居場所が決まらなければ引用を含むブロックへ寄せる", () => {
    const el = content("さきの段落。", "引用のことばが入っている段落。");
    const marks = readingMarks(
      el,
      base,
      [
        thread({
          quote: "引用のことばが入っている段落。",
          selection: "引用のことばが入っている",
        }),
      ],
      resolved({ state: "unknown", index: -1 }),
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].guess).toBe(true);
    expect(marks[0].moved).toBe(true);
    // 2 つめのブロック（上端 100）に寄っている。
    expect(marks[0].spots[0]?.top ?? marks[0].areas[0].top).toBeGreaterThan(50);
  });

  it("手がかりも無ければ出さない", () => {
    const el = content("まったく別の話。");
    const marks = readingMarks(
      el,
      base,
      [thread({ quote: "どこにも無い引用", selection: "どこにも無い" })],
      resolved({ state: "unknown", index: -1 }),
    );
    expect(marks).toHaveLength(0);
  });

  it("対応付けが済んでいない指摘は出さない", () => {
    const el = content("はじめの段落。");
    expect(readingMarks(el, base, [thread()], new Map())).toHaveLength(0);
  });

  it("矩形は重ねる先の左上からの座標で返す", () => {
    const el = content("はじめの段落。", "つぎの段落。");
    const marks = readingMarks(
      el,
      new DOMRect(0, 40, 600, 300),
      [thread({ quote: "つぎの段落。", selection: "つぎ" })],
      resolved({ state: "unchanged", index: 1, head: block(1, "つぎの段落。") }),
    );
    expect(marks[0].spots[0].top).toBe(100 + 2 - 40);
  });
});

describe("readingPending", () => {
  it("選んだ範囲を出す", () => {
    const el = content("はじめの段落。");
    const rc = readingPending(el, base, {
      blockIndex: 0,
      offset: 0,
      length: 3,
    });
    expect(rc.length).toBeGreaterThan(0);
  });

  it("ブロック丸ごとなら、またいだ分の枠を並べる", () => {
    const el = content("はじめの段落。", "つぎの段落。", "みっつめ。");
    const rc = readingPending(el, base, {
      blockIndex: 0,
      offset: 0,
      length: 0,
      whole: true,
      until: 1,
    });
    expect(rc).toHaveLength(2);
    expect(rc[1].top).toBe(100);
  });

  it("まだ出ていないブロックでは何も出さない", () => {
    const el = content("はじめの段落。");
    expect(
      readingPending(el, base, { blockIndex: 9, offset: 0, length: 1 }),
    ).toHaveLength(0);
  });
});

// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import type { Block } from "./blocks";
import type { Resolution } from "./blockDiff";
import type { ReviewThread } from "./review";
import { readingMarks, readingPending, textRects } from "./reviewMarks";

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

// 箇条書きのブロック。項目には描画側と同じ目印（data-mg-item）を付ける。
// 2 個目は中身が無い項目（`- [ ]` だけの行）で、選択の文字を持たない。
function listContent(opts?: { nested?: boolean }): {
  article: HTMLElement;
  item: HTMLElement;
} {
  const article = document.createElement("article");
  rects.set(article, new DOMRect(0, 0, 600, 200));
  const wrap = document.createElement("div");
  wrap.dataset.mgBlock = "0";
  rects.set(wrap, new DOMRect(0, 0, 600, 200));
  const ul = document.createElement("ul");
  rects.set(ul, new DOMRect(0, 0, 600, 200));
  const anchors = [0, 14, 21];
  const texts = ["さいしょ", "", "さいご"];
  let item: HTMLElement | null = null;
  anchors.forEach((anchor, i) => {
    const li = document.createElement("li");
    li.dataset.mgItem = String(anchor);
    li.textContent = texts[i];
    rects.set(li, new DOMRect(0, i * 60, 600, 60));
    ul.appendChild(li);
    if (i === 1) {
      item = li;
      // 2 個目に入れ子を持たせる。親の箱は子の分だけ下へ伸びる。
      if (opts?.nested) {
        const inner = document.createElement("ul");
        const child = document.createElement("li");
        child.dataset.mgItem = "40";
        child.textContent = "こ";
        rects.set(inner, new DOMRect(20, 100, 580, 100));
        rects.set(child, new DOMRect(20, 100, 580, 100));
        inner.appendChild(child);
        li.appendChild(inner);
        rects.set(li, new DOMRect(0, 60, 600, 140));
      }
    }
  });
  wrap.appendChild(ul);
  article.appendChild(wrap);
  document.body.appendChild(article);
  return { article, item: item! };
}

const LIST_SRC = "- さいしょ\n\n- [ ]\n\n- さいご";

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

  it("引き先を持つ指摘は、その項目の箱に出す", () => {
    // 中身の無い項目は選択の文字を持たない。引き先が無いとブロック全体への
    // 指摘と同じ見た目になり、リスト全体に付いたように見える。
    const { article, item } = listContent();
    const marks = readingMarks(
      article,
      base,
      [
        thread({
          quote: LIST_SRC,
          selection: "",
          selection_offset: 5,
          unit: { kind: "item", index: 1 },
        }),
      ],
      resolved({ state: "unchanged", index: 0, head: block(0, LIST_SRC) }),
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].spots).toHaveLength(1);
    // その項目の箱ちょうど（ブロックは 0〜200、項目は 60〜120）
    expect(marks[0].spots[0].top).toBe(item.getBoundingClientRect().top);
    expect(marks[0].spots[0].height).toBe(60);
    // 箇所が出せているので、ブロックの枠は添えない
    expect(marks[0].areas).toHaveLength(0);
  });

  it("親の項目の印は、入れ子の一覧まで伸びない", () => {
    // 親の箱は入れ子を抱えている（40〜200）。印は親の分（40〜100）で終える。
    const { article } = listContent({ nested: true });
    const marks = readingMarks(
      article,
      base,
      [
        thread({
          quote: LIST_SRC,
          selection: "",
          selection_offset: 5,
          unit: { kind: "item", index: 1 },
        }),
      ],
      resolved({ state: "unchanged", index: 0, head: block(0, LIST_SRC) }),
    );
    expect(marks[0].spots).toHaveLength(1);
    expect(marks[0].spots[0].top).toBe(60);
    expect(marks[0].spots[0].height).toBe(40);
  });

  it("引き先が引けなければブロックの枠に落とす", () => {
    // 項目が消えている（書き換わった）ときは、少なくとも場所は示す。
    const { article } = listContent();
    const marks = readingMarks(
      article,
      base,
      [
        thread({
          quote: LIST_SRC,
          selection: "",
          selection_offset: 5,
          unit: { kind: "item", index: 9 },
        }),
      ],
      resolved({ state: "unchanged", index: 0, head: block(0, LIST_SRC) }),
    );
    expect(marks[0].spots).toHaveLength(0);
    expect(marks[0].areas.length).toBeGreaterThan(0);
  });

  it("引き先を持たない指摘は今までどおりブロック全体で出す", () => {
    const { article } = listContent();
    const marks = readingMarks(
      article,
      base,
      [thread({ quote: LIST_SRC, selection: "", selection_offset: 0 })],
      resolved({ state: "unchanged", index: 0, head: block(0, LIST_SRC) }),
    );
    expect(marks[0].spots).toHaveLength(0);
    expect(marks[0].areas.length).toBeGreaterThan(0);
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

describe("textRects", () => {
  it("字の箱だけを返す（丸ごと入っている要素の枠は返さない）", () => {
    const el = content("はじめの段落。");
    const p = el.querySelector("p")!;
    // 段落の中に囲みの要素を 1 つ置き、その箱には別の大きさを持たせる。
    const code = document.createElement("code");
    code.textContent = "コード";
    p.appendChild(code);
    rects.set(code, new DOMRect(0, 0, 999, 999));
    const range = document.createRange();
    range.selectNodeContents(p);
    // 文字ノードごとに測るので、置いた要素の箱（999）は混ざらない。
    for (const rc of textRects(range)) expect(rc.width).toBeLessThan(999);
  });

  it("範囲の外の文字は数えない", () => {
    const el = content("はじめの段落。", "つぎの段落。");
    const first = el.querySelectorAll("p")[0].firstChild as Text;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(first, 3);
    expect(textRects(range).length).toBeGreaterThan(0);
  });
});

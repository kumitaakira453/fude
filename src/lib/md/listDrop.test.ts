// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { intoItem } from "./listDrop";
import { schema } from "./schema";
import { toMarkdown } from "./toMarkdown";

// 箇条書きの上へ運んだ塊の落とし先。項目と項目の間には置けないので、
// 項目の中（字の下に字下げした子）の位置を返す。
//
// jsdom は組版をしないので、段落を 30px おきに 20px の高さで縦に並べ、
// 深さ 1 段ごとに 24px 字下げした位置を持たせる。

const rects = new WeakMap<Element, DOMRect>();
const real = Element.prototype.getBoundingClientRect;

let open: { view: EditorView; place: HTMLElement } | null = null;

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
  Element.prototype.getBoundingClientRect = real;
});

const box = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top }) as DOMRect;

function editor(body: string) {
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({ doc: loaded.doc, plugins: [] }),
  });
  open = { view, place };
  view.dom.querySelectorAll("p").forEach((p, i) => {
    let depth = 0;
    for (let el = p.parentElement; el && el !== view.dom; el = el.parentElement) {
      if (el.tagName === "LI") depth++;
    }
    rects.set(p, box(depth * 24, i * 30, 600, i * 30 + 20));
  });
  // 項目と並びは、中の段落を包む箱。
  for (const el of view.dom.querySelectorAll("li, ul, ol")) {
    const inner = Array.from(el.querySelectorAll("p")).map((p) => rects.get(p)!);
    rects.set(el, box(inner[0].left - 24, inner[0].top, 600, inner[inner.length - 1].bottom));
  }
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return rects.get(this) ?? box(0, 0, 0, 0);
  };
  const list = view.dom.querySelector<HTMLElement>(":scope > ul")!;
  return { view, list, loaded };
}

// 落とす位置の、入れ物の項目の 1 行目と、その中で何番目か。
function where(view: EditorView, pos: number) {
  const $at = view.state.doc.resolve(pos);
  return {
    item: $at.parent.type === schema.nodes.listItem ? $at.parent.firstChild?.textContent : null,
    index: $at.index(),
    of: $at.parent.childCount,
  };
}

const BODY = "- 一\n- 二\n  - 二の一\n- 三\n";
// 段落の並び：一 0〜20、二 30〜50、二の一 60〜80、三 90〜110。

describe("箇条書きの中への落とし先", () => {
  it("項目の 1 行目の下半分なら、その項目の字の下に入れる", () => {
    const { view, list } = editor(BODY);
    const spot = intoItem(view, list, 15)!;
    expect(where(view, spot.pos)).toEqual({ item: "一", index: 1, of: 1 });
    // 線は字の下端に、字の左端から引く。
    expect(spot.line).toMatchObject({ top: 20, left: 24 });
  });

  it("子の並びを持つ項目でも、字の下（子の並びより上）に入れる", () => {
    const { view, list } = editor(BODY);
    expect(where(view, intoItem(view, list, 45)!.pos)).toEqual({ item: "二", index: 1, of: 2 });
  });

  it("上半分なら、前の項目の末尾に入れる", () => {
    const { view, list } = editor(BODY);
    expect(where(view, intoItem(view, list, 35)!.pos)).toEqual({ item: "一", index: 1, of: 1 });
    // 前の項目が子の並びを持つなら、その後ろ。
    expect(where(view, intoItem(view, list, 95)!.pos)).toEqual({ item: "二", index: 2, of: 2 });
  });

  it("入れ子の最初の項目の上半分なら、親の項目の字の下に入れる", () => {
    const { view, list } = editor(BODY);
    expect(where(view, intoItem(view, list, 65)!.pos)).toEqual({ item: "二", index: 1, of: 2 });
  });

  it("いちばん外の最初の項目の上半分は、呼ぶ側（並びの前）に任せる", () => {
    const { view, list } = editor(BODY);
    expect(intoItem(view, list, 5)).toBeNull();
  });

  it("入れた画像は、項目の下に字下げして書き出す", () => {
    const { view, list, loaded } = editor(BODY);
    const { pos } = intoItem(view, list, 15)!;
    const image = schema.nodes.imageBlock.create({ src: "./images/図.png", alt: "", title: null });
    view.dispatch(view.state.tr.insert(pos, image));
    expect(toMarkdown(view.state.doc, loaded)).toMatch(/- 一\n+ {2}!\[\]\(\.\/images\/図\.png\)\n/);
  });
});

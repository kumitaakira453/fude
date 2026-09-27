// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { nodeViews } from "./nodeViews";
import { toMarkdown } from "./toMarkdown";

// 画像の寄せと幅。帯の 3 つで寄せを変え、左右の端のつまみで幅を変える。
// 本文へ書くのは、押したとき・離したときの一度だけ。

let open: { view: EditorView; place: HTMLElement } | null = null;

// 入れ物（本文の幅）は 600、絵の桁は 300 とみなす。
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    const width = this.classList.contains("mg-img-body") ? 600 : this.classList.contains("mg-img-col") ? 300 : 0;
    return new DOMRect(0, 0, width, 100);
  };
  Element.prototype.setPointerCapture = () => {};
});

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
});

const ways = () => ({
  stow: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  take: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  pick: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  copy: vi.fn(),
});

function editor(body: string) {
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({ doc: loaded.doc, plugins: [] }),
    nodeViews: nodeViews({
      dark: false,
      modes: new Map(),
      redraws: new Set(),
      peekAsset: () => "blob:図解",
      images: ways(),
    }),
  });
  open = { view, place };
  return {
    view,
    out: () => toMarkdown(view.state.doc, loaded),
    img: () => view.dom.querySelector<HTMLElement>(".mg-img")!,
    press: (title: string) =>
      view.dom.querySelector<HTMLElement>(`.mg-img-bar button[aria-label="${title}"]`)!.click(),
    button: (title: string) =>
      view.dom.querySelector<HTMLElement>(`.mg-img-bar button[aria-label="${title}"]`)!,
    grip: (side: "left" | "right") => view.dom.querySelector<HTMLElement>(`.mg-img-grip.is-${side}`)!,
  };
}

const pointer = (el: HTMLElement, type: string, x: number) => {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x });
  Object.defineProperty(event, "pointerId", { value: 1 });
  el.dispatchEvent(event);
};

describe("寄せ", () => {
  it("帯の右寄せで <p align> の形になり、いまの寄せが強く出る", () => {
    const e = editor("![図](./images/a.png)\n");
    expect(e.button("中央").classList.contains("is-on")).toBe(true);
    e.press("右寄せ");
    expect(e.out()).toBe('<p align="right"><img src="./images/a.png" alt="図"></p>\n');
    expect(e.img().dataset.align).toBe("right");
    expect(e.button("右寄せ").classList.contains("is-on")).toBe(true);
  });

  it("中央に戻すと ![]() に戻る", () => {
    const e = editor('<p align="left"><img src="./images/a.png" alt="図"></p>\n');
    e.press("中央");
    expect(e.out()).toBe("![図](./images/a.png)\n");
    expect(e.img().dataset.align).toBeUndefined();
  });
});

describe("幅", () => {
  it("右のつまみを引くと、離したときに % で書く（中央は両側へ伸びる）", () => {
    const e = editor("![図](./images/a.png)\n");
    const grip = e.grip("right");
    pointer(grip, "pointerdown", 0);
    pointer(grip, "pointermove", 30);
    // 動かしている間は本文を書き換えない
    expect(e.out()).toBe("![図](./images/a.png)\n");
    pointer(grip, "pointerup", 30);
    // 300 + 30×2 = 360 / 600 = 60%
    expect(e.out()).toBe('<img src="./images/a.png" alt="図" width="60%">\n');
    expect(e.img().classList.contains("is-sized")).toBe(true);
  });

  it("本文の幅を超えない（100% まで）", () => {
    const e = editor('<p align="left"><img src="./images/a.png" alt="図"></p>\n');
    const grip = e.grip("right");
    pointer(grip, "pointerdown", 0);
    pointer(grip, "pointermove", 900);
    pointer(grip, "pointerup", 900);
    expect(e.out()).toBe('<p align="left"><img src="./images/a.png" alt="図" width="100%"></p>\n');
  });

  it("寄せた絵は、掴んだ側だけが動く（左のつまみは左へ引くと広がる）", () => {
    const e = editor('<p align="right"><img src="./images/a.png" alt="図"></p>\n');
    const grip = e.grip("left");
    pointer(grip, "pointerdown", 100);
    pointer(grip, "pointermove", 40);
    pointer(grip, "pointerup", 40);
    // 300 + 60 = 360 / 600 = 60%
    expect(e.out()).toBe('<p align="right"><img src="./images/a.png" alt="図" width="60%"></p>\n');
  });

  it("動かさずに離したら書かない", () => {
    const e = editor("![図](./images/a.png)\n");
    const grip = e.grip("right");
    pointer(grip, "pointerdown", 10);
    pointer(grip, "pointerup", 10);
    expect(e.out()).toBe("![図](./images/a.png)\n");
  });
});

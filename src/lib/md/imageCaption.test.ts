// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { nodeViews } from "./nodeViews";
import { toMarkdown } from "./toMarkdown";

// 画像のキャプション。Markdown の代替テキスト（![ここ](src)）そのもの。
//
// 書かれているときだけ出す。空のまま欄が並ぶと、画像を置くたびに書かされて
// いるように見える。

let open: { view: EditorView; place: HTMLElement } | null = null;

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
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
    }),
  });
  open = { view, place };
  return {
    view,
    out: () => toMarkdown(view.state.doc, loaded),
    img: () => view.dom.querySelector<HTMLElement>(".mg-img")!,
    cap: () => view.dom.querySelector<HTMLInputElement>(".mg-cap")!,
  };
}

describe("画像のキャプション", () => {
  it("書かれていれば出す", () => {
    const at = editor("![滞留の内訳](./images/図解.png)\n");
    expect(at.img().classList.contains("has-cap")).toBe(true);
    expect(at.cap().value).toBe("滞留の内訳");
  });

  it("書かれていなければ出さない", () => {
    const at = editor("![](./images/図解.png)\n");
    expect(at.img().classList.contains("has-cap")).toBe(false);
    expect(at.cap().value).toBe("");
  });

  it("打つと本文の代替テキストになる", () => {
    const at = editor("![](./images/図解.png)\n");
    const field = at.cap();
    field.value = "滞留の内訳";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(at.out()).toBe("![滞留の内訳](./images/図解.png)\n");
  });

  it("打っているあいだ、絵を描き直さない", () => {
    const at = editor("![](./images/図解.png)\n");
    const before = at.img().querySelector("img");
    const field = at.cap();
    field.value = "滞";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    // 打鍵ごとに作り直すと、絵がその都度読み直されて点滅する。
    expect(at.img().querySelector("img")).toBe(before);
  });

  it("空のまま離れたら、欄はしまう", () => {
    const at = editor("![](./images/図解.png)\n");
    const img = at.img();
    // つまみのメニューから出したのと同じ状態にする。
    img.classList.add("has-cap");
    at.cap().dispatchEvent(new FocusEvent("blur"));
    expect(img.classList.contains("has-cap")).toBe(false);
  });

  it("書いてから離れたら、欄は出したまま", () => {
    const at = editor("![滞留の内訳](./images/図解.png)\n");
    at.cap().dispatchEvent(new FocusEvent("blur"));
    expect(at.img().classList.contains("has-cap")).toBe(true);
  });
});

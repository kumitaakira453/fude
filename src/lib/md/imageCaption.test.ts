// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { imageCaret, nodeViews } from "./nodeViews";
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

const ways = (chosen: string | null = "/Users/me/写真/新しい.png") => ({
  stow: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  take: vi.fn((): Promise<string | null> => Promise.resolve("./images/新しい.png")),
  pick: vi.fn((): Promise<string | null> => Promise.resolve(chosen)),
  copy: vi.fn(),
});

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function editor(body: string, images = ways()) {
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({ doc: loaded.doc, plugins: [imageCaret] }),
    nodeViews: nodeViews({
      dark: false,
      modes: new Map(),
      redraws: new Set(),
      peekAsset: () => "blob:図解",
      images,
    }),
  });
  open = { view, place };
  return {
    view,
    images,
    out: () => toMarkdown(view.state.doc, loaded),
    img: () => view.dom.querySelector<HTMLElement>(".mg-img")!,
    cap: () => view.dom.querySelector<HTMLInputElement>(".mg-cap")!,
    press: (title: string) =>
      view.dom.querySelector<HTMLElement>(`.mg-img-bar button[aria-label="${title}"]`)?.click(),
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

  it("打っているあいだは本文を書き換えない", () => {
    // 打鍵ごとに書き換えると、ProseMirror が DOM の選択を本文へ戻し、
    // 1 文字目で欄から手が離れる。
    const at = editor("![](./images/図解.png)\n");
    const field = at.cap();
    field.value = "滞留の内訳";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(at.out()).toBe("![](./images/図解.png)\n");
  });

  it("離れたときに一度だけ本文へ書く", () => {
    const at = editor("![](./images/図解.png)\n");
    const field = at.cap();
    field.value = "滞留の内訳";
    field.dispatchEvent(new FocusEvent("blur"));
    expect(at.out()).toBe("![滞留の内訳](./images/図解.png)\n");
  });

  it("Enter で欄を離れ、書いた字が残る", () => {
    const at = editor("![](./images/図解.png)\n");
    const field = at.cap();
    field.focus();
    field.value = "滞留の内訳";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(at.out()).toBe("![滞留の内訳](./images/図解.png)\n");
    expect(at.img().classList.contains("has-cap")).toBe(true);
  });

  it("Escape なら書かずに戻す", () => {
    const at = editor("![滞留の内訳](./images/図解.png)\n");
    const field = at.cap();
    field.focus();
    field.value = "打ちかけ";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(at.out()).toBe("![滞留の内訳](./images/図解.png)\n");
    expect(field.value).toBe("滞留の内訳");
  });

  it("手があるあいだは、本文の側で欄を上書きしない", () => {
    const at = editor("![](./images/図解.png)\n");
    const field = at.cap();
    field.focus();
    field.value = "打ちかけ";
    // 別の書き換え（置換など）が本文に入っても、打っている字は消さない。
    at.view.dispatch(at.view.state.tr.setNodeMarkup(0, null, {
      src: "./images/別.png",
      alt: "",
      title: null,
    }));
    expect(field.value).toBe("打ちかけ");
  });

  it("書いてから離れても、絵は描き直さない", () => {
    const at = editor("![](./images/図解.png)\n");
    const before = at.img().querySelector("img");
    const field = at.cap();
    field.value = "滞";
    field.dispatchEvent(new FocusEvent("blur"));
    // 道筋が同じなら作り直さない。作り直すと絵が読み直されて点滅する。
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

describe("絵の上に出す帯", () => {
  it("絵にぴったり付ける（入れ物ではなく）", () => {
    const at = editor("![](./images/図解.png)\n");
    const bar = at.view.dom.querySelector(".mg-img-bar");
    expect(bar?.parentElement?.className).toBe("mg-img-hold");
  });

  it("キャプションを押すと、空でも欄が出て手が渡る", () => {
    const at = editor("![](./images/図解.png)\n");
    at.press("キャプション");
    expect(at.img().classList.contains("has-cap")).toBe(true);
    expect(document.activeElement).toBe(at.cap());
  });

  it("置換で道筋が差し替わる（キャプションは残る）", async () => {
    const at = editor("![滞留の内訳](./images/図解.png)\n");
    at.press("置換");
    await settle();
    expect(at.out()).toBe("![滞留の内訳](./images/新しい.png)\n");
  });

  it("選び直さなければ何も起きない", async () => {
    const images = ways(null);
    const at = editor("![](./images/図解.png)\n", images);
    at.press("置換");
    await settle();
    expect(images.take).not.toHaveBeenCalled();
    expect(at.out()).toBe("![](./images/図解.png)\n");
  });

  it("コピーは今の道筋を渡す", () => {
    const at = editor("![](./images/図解.png)\n");
    at.press("画像をコピー");
    expect(at.images.copy).toHaveBeenCalledWith("./images/図解.png");
  });
});

describe("絵の隣のカーソル", () => {
  // 絵の隣では行箱が絵の丈になり、カーソルも絵と同じ丈で立つ。棒は消して
  // 絵の縁で居場所を示す。
  const put = (view: EditorView, at: number) =>
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));

  it("絵の直後では、その絵に印を出す", () => {
    const at = editor("![](./images/図解.png)\n");
    put(at.view, 2);
    expect(at.view.dom.querySelector(".mg-img.is-here")).not.toBeNull();
  });

  it("絵の直前でも同じ", () => {
    const at = editor("![](./images/図解.png)\n");
    put(at.view, 1);
    expect(at.view.dom.querySelector(".mg-img.is-here")).not.toBeNull();
  });

  it("字と混ざっていても、絵の隣なら付ける", () => {
    const at = editor("k![](./images/図解.png)\n");
    put(at.view, 2);
    expect(at.view.dom.querySelector(".mg-img.is-here")).not.toBeNull();
  });

  it("絵から離れていれば付けない", () => {
    const at = editor("k![](./images/図解.png)\n");
    put(at.view, 1);
    expect(at.view.dom.querySelector(".mg-img.is-here")).toBeNull();
  });

  it("絵の無い塊では何もしない", () => {
    const at = editor("本文\n");
    put(at.view, 1);
    expect(at.view.dom.querySelector(".mg-img.is-here")).toBeNull();
  });

  it("次の行へ移ったら印も外れる（持ち越さない）", () => {
    const at = editor("![](./images/図解.png)\n\n次\n");
    put(at.view, 2);
    expect(at.view.dom.querySelector(".mg-img.is-here")).not.toBeNull();
    put(at.view, at.view.state.doc.content.size - 1);
    expect(at.view.dom.querySelector(".mg-img.is-here")).toBeNull();
  });

  it("字を打って位置が動いたときも、印は今の場所に合う", () => {
    const at = editor("![](./images/図解.png)\n\n次\n");
    put(at.view, at.view.state.doc.content.size - 1);
    at.view.dispatch(at.view.state.tr.insertText("あ"));
    expect(at.view.dom.querySelector(".mg-img.is-here")).toBeNull();
  });
});

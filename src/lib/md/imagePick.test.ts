// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { imagePicker, openImagePick } from "./imagePick";
import { toMarkdown } from "./toMarkdown";

// /image で出す仮置きの枠。
//
// 見たいのは「画像が決まるまで本文に何も書かない」こと。先に `![]()` を
// 書くと、選ぶ前に保存が走ったとき壊れた記法が文書に残る。

let open: { view: EditorView; place: HTMLElement } | null = null;

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
});

const goes = (chosen: string | null, src: string | null) => ({
  stow: vi.fn(() => Promise.resolve(null)),
  take: vi.fn(() => Promise.resolve(src)),
  pick: vi.fn(() => Promise.resolve(chosen)),
  copy: vi.fn(),
});

function editor(body: string, ways: ReturnType<typeof goes>) {
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({ doc: loaded.doc, plugins: [imagePicker(ways)] }),
  });
  open = { view, place };
  return {
    view,
    out: () => toMarkdown(view.state.doc, loaded),
    frame: () => view.dom.querySelector(".mg-imgpick"),
    button: (sel: string) => view.dom.querySelector<HTMLElement>(sel),
  };
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("仮置きの枠", () => {
  it("/image で出る", () => {
    const at = editor("本文\n", goes(null, null));
    expect(at.frame()).toBeNull();
    openImagePick(at.view);
    expect(at.frame()).not.toBeNull();
  });

  it("出しただけでは本文に何も書かない", () => {
    const at = editor("本文\n", goes(null, null));
    openImagePick(at.view);
    expect(at.out()).toBe("本文\n");
  });

  it("選んだら画像を書いて、枠を閉じる", async () => {
    const ways = goes("/Users/me/写真/図解.png", "./images/図解.png");
    const at = editor("本文\n", ways);
    openImagePick(at.view);
    at.button(".mg-imgpick-open")?.click();
    await settle();
    expect(ways.take).toHaveBeenCalledWith("/Users/me/写真/図解.png");
    expect(at.out()).toContain("![](./images/図解.png)");
    expect(at.frame()).toBeNull();
  });

  it("選ばなければ枠は開いたまま", async () => {
    const ways = goes(null, "./images/図解.png");
    const at = editor("本文\n", ways);
    openImagePick(at.view);
    at.button(".mg-imgpick-open")?.click();
    await settle();
    expect(ways.take).not.toHaveBeenCalled();
    expect(at.frame()).not.toBeNull();
  });

  it("枠は塊の外に出す（段落の中に差すと行の丈がカーソルの丈になる）", () => {
    const at = editor("本文\n", goes(null, null));
    openImagePick(at.view);
    const frame = at.frame()!;
    expect(frame.closest("p")).toBeNull();
  });

  it("空になった塊はしまう", () => {
    const at = editor("\n", goes(null, null));
    openImagePick(at.view);
    expect(at.view.dom.querySelector(".mg-imgpick-gone")).not.toBeNull();
  });

  it("字の残っている塊はしまわない", () => {
    const at = editor("本文\n", goes(null, null));
    openImagePick(at.view);
    expect(at.view.dom.querySelector(".mg-imgpick-gone")).toBeNull();
  });

  it("取り込めなければ本文は変えず、枠も残す", async () => {
    const ways = goes("/Users/me/無い.png", null);
    const at = editor("本文\n", ways);
    openImagePick(at.view);
    at.button(".mg-imgpick-open")?.click();
    await settle();
    expect(at.out()).toBe("本文\n");
    expect(at.frame()).not.toBeNull();
  });

  it("やめる印で閉じる", () => {
    const at = editor("本文\n", goes(null, null));
    openImagePick(at.view);
    at.button(".mg-imgpick-x")?.click();
    expect(at.frame()).toBeNull();
  });

  it("何か載っている塊では、枠を下に出して新しい塊へ入れる", async () => {
    const ways = goes("/Users/me/写真/次.png", "./images/次.png");
    const at = editor("本文\n", ways);
    at.view.dispatch(
      at.view.state.tr.setSelection(TextSelection.create(at.view.state.doc, 1)),
    );
    openImagePick(at.view);
    at.button(".mg-imgpick-open")?.click();
    await settle();
    expect(at.out()).toBe("本文\n\n![](./images/次.png)\n");
  });

  it("空の塊は、絵にそのまま差し替える", async () => {
    const ways = goes("/Users/me/写真/次.png", "./images/次.png");
    const at = editor("\n", ways);
    openImagePick(at.view);
    at.button(".mg-imgpick-open")?.click();
    await settle();
    expect(at.out()).toBe("![](./images/次.png)\n");
  });

  it("本文を書き始めたら閉じる", () => {
    const at = editor("本文\n", goes(null, null));
    openImagePick(at.view);
    at.view.dispatch(at.view.state.tr.insertText("あ", 1));
    expect(at.frame()).toBeNull();
  });
});

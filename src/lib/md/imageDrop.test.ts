// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { canHold, loneImage, pasteImages, takeImages } from "./imageDrop";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 写しにある画像をアプリ側から読むところ。試験では画像がある体で返す。
const native = vi.hoisted(() => ({ image: null as { bytes: Uint8Array; mime: string } | null }));
vi.mock("../clip", () => ({ pastedImage: () => Promise.resolve(native.image) }));

// 持ち込まれた画像を本文へ入れるところ。
//
// 編集面はブロックの移動にも同じ仕組みを使っているので、「受けるものと
// 素通しするもの」の切り分けをここで見る。

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
  });
  open = { view, place };
  return { view, out: () => toMarkdown(view.state.doc, loaded) };
}

const shot = (name: string, type: string) => new File([new Uint8Array([1, 2])], name, { type });

// 取り込み先。渡された順に道筋を返す。
const stows = (...paths: string[]) => {
  let n = 0;
  const next = () => Promise.resolve(paths[n++] ?? null);
  return {
    stow: vi.fn(next),
    take: vi.fn(next),
    pick: vi.fn(() => Promise.resolve(null)),
    copy: vi.fn(),
  };
};

// 待ちが 2 段（中身を読む → 取り込む）あるので、片付くまで回す。
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("canHold", () => {
  it("段落の中には置ける", () => {
    const { view } = editor("本文\n");
    expect(canHold(view, 1)).toBe(true);
  });

  it("コードの塊の中には置かない", () => {
    const { view } = editor("```js\nconst a = 1;\n```\n");
    expect(canHold(view, 2)).toBe(false);
  });
});

describe("takeImages", () => {
  it("画像を持つ持ち込みは受けて、その位置に書く", async () => {
    const { view, out } = editor("本文\n");
    const goes = stows("./images/図解.png");
    expect(takeImages(view, { files: [shot("図解.png", "image/png")] }, 3, goes)).toBe(true);
    await settle();
    expect(out()).toContain("![](./images/図解.png)");
  });

  it("画像を持たない持ち込みは素通しする（ブロックの移動を壊さない）", () => {
    const { view } = editor("本文\n");
    const goes = stows("./images/図解.png");
    expect(takeImages(view, { files: [] }, 1, goes)).toBe(false);
    expect(takeImages(view, null, 1, goes)).toBe(false);
    expect(goes.stow).not.toHaveBeenCalled();
  });

  it("字のファイルは拾わない", () => {
    const { view } = editor("本文\n");
    const goes = stows("./images/a.png");
    expect(takeImages(view, { files: [shot("覚書.md", "text/markdown")] }, 1, goes)).toBe(false);
  });

  it("コードの塊の中では受けない", () => {
    const { view } = editor("```js\nconst a = 1;\n```\n");
    const goes = stows("./images/図解.png");
    expect(takeImages(view, { files: [shot("図解.png", "image/png")] }, 2, goes)).toBe(false);
  });

  it("取り込めなかったものは本文に書かない", async () => {
    const { view, out } = editor("本文\n");
    const goes = { ...stows(), stow: vi.fn(() => Promise.resolve(null)) };
    expect(takeImages(view, { files: [shot("図解.png", "image/png")] }, 3, goes)).toBe(true);
    await settle();
    expect(out()).not.toContain("![]");
  });

  it("複数枚は落とした順に並ぶ", async () => {
    const { view, out } = editor("本文\n");
    const goes = stows("./images/1.png", "./images/2.png");
    takeImages(
      view,
      { files: [shot("1.png", "image/png"), shot("2.png", "image/png")] },
      3,
      goes,
    );
    await settle();
    const text = out();
    expect(text.indexOf("1.png")).toBeLessThan(text.indexOf("2.png"));
  });
});

describe("loneImage", () => {
  it("画像だけの塊なら、その画像を返す", () => {
    const { view } = editor("![](./images/図解.png)\n");
    const held = loneImage(view.state.doc, 0);
    expect(held?.node.attrs.src).toBe("./images/図解.png");
  });

  it("字と混ざっている行は返さない（どの絵の話か決められない）", () => {
    const { view } = editor("前 ![](./images/図解.png) 後\n");
    expect(loneImage(view.state.doc, 0)).toBeNull();
  });

  it("画像の無い塊は返さない", () => {
    const { view } = editor("本文\n");
    expect(loneImage(view.state.doc, 0)).toBeNull();
  });
});

describe("編集面への組み込み", () => {
  it("取り込みを渡したときだけ、落とすのと貼るのを受ける", () => {
    const withImages = editorPlugins({ onSave: () => {}, images: stows("./images/a.png") });
    expect(withImages.some((p) => p.props.handleDrop)).toBe(true);

    const without = editorPlugins({ onSave: () => {} });
    expect(without.some((p) => p.props.handleDrop)).toBe(false);
  });

  it("字としての貼り付けより先に見る", () => {
    const plugins = editorPlugins({ onSave: () => {}, images: stows("./images/a.png") });
    const pasters = plugins.filter((p) => p.props.handlePaste);
    // 先に並んだほうが先に見る。画像の取り込みだけが落とすのも持っている。
    expect(pasters.length).toBeGreaterThan(1);
    expect(pasters[0].props.handleDrop).toBeTruthy();
  });
});

// 貼り付けの知らせの形。字の種類ごとに中身を持つ。
const clip = (over: {
  files?: File[];
  items?: { kind: string; getAsFile(): File | null }[];
  text?: Record<string, string>;
}) => ({
  files: over.files ?? [],
  items: over.items ?? [],
  getData: (format: string) => over.text?.[format] ?? "",
});

describe("pasteImages", () => {
  it("files に無くても items にある画像を拾う", async () => {
    const { view, out } = editor("本文\n");
    const goes = stows("./images/写し.png");
    const file = shot("image.png", "image/png");
    expect(pasteImages(view, clip({ items: [{ kind: "file", getAsFile: () => file }] }), 3, goes)).toBe(true);
    await settle();
    expect(out()).toContain("![](./images/写し.png)");
  });

  it("Finder で写したファイルは、道筋から取り込む", async () => {
    const { view, out } = editor("本文\n");
    const goes = stows("./images/図.png");
    const data = clip({ text: { "text/uri-list": "file:///Users/me/%E5%9B%B3.png", "text/plain": "図.png" } });
    expect(pasteImages(view, data, 3, goes)).toBe(true);
    await settle();
    expect(goes.take).toHaveBeenCalledWith("/Users/me/図.png");
    expect(out()).toContain("![](./images/図.png)");
  });

  it("字の無い貼り付けは、アプリ側から画像を読む", async () => {
    native.image = { bytes: new Uint8Array([1]), mime: "image/png" };
    const { view, out } = editor("本文\n");
    const goes = stows("./images/画面.png");
    expect(pasteImages(view, clip({}), 3, goes)).toBe(true);
    await settle();
    expect(goes.stow).toHaveBeenCalledWith({ bytes: native.image.bytes, name: null, mime: "image/png" });
    expect(out()).toContain("![](./images/画面.png)");
    native.image = null;
  });

  it("字の貼り付けは素通しする", () => {
    const { view } = editor("本文\n");
    const goes = stows("./images/a.png");
    expect(pasteImages(view, clip({ text: { "text/plain": "ことば" } }), 3, goes)).toBe(false);
    expect(goes.stow).not.toHaveBeenCalled();
    expect(goes.take).not.toHaveBeenCalled();
  });

  it("画像でないファイルの道筋は拾わない", () => {
    const { view } = editor("本文\n");
    const goes = stows("./images/a.png");
    const data = clip({ text: { "text/uri-list": "file:///Users/me/memo.md", "text/plain": "memo.md" } });
    expect(pasteImages(view, data, 3, goes)).toBe(false);
  });
});

describe("落とした境目へ入れる", () => {
  it("境目を渡したら、その塊の上に入る（カーソルの位置へは寄せない）", async () => {
    const { view, out } = editor("一つ目\n\n二つ目\n");
    const goes = stows("./images/図.png");
    // 2 つ目の段落の前の境目
    const at = view.state.doc.child(0).nodeSize;
    expect(takeImages(view, { files: [shot("図.png", "image/png")] }, at, goes, true)).toBe(true);
    await settle();
    expect(out()).toBe("一つ目\n\n![](./images/図.png)\n\n二つ目\n");
  });

  it("複数枚は 1 枚目の直後に並ぶ", async () => {
    const { view, out } = editor("一つ目\n\n二つ目\n");
    const goes = stows("./images/1.png", "./images/2.png");
    takeImages(view, { files: [shot("1.png", "image/png"), shot("2.png", "image/png")] }, 0, goes, true);
    await settle();
    expect(out()).toBe("![](./images/1.png)\n\n![](./images/2.png)\n\n一つ目\n\n二つ目\n");
  });
});


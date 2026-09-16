// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { canHold, takeImages } from "./imageDrop";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

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
  return { stow: vi.fn(() => Promise.resolve(paths[n++] ?? null)) };
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
    const goes = { stow: vi.fn(() => Promise.resolve(null)) };
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

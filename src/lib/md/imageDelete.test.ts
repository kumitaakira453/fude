// @vitest-environment jsdom
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 絵を消すときの一段。
//
// 絵は塊のように描かれるので、その直後は「次の行」に見える。窓に任せると
// 一打で絵が消え、消したつもりのない絵が黙って無くなる。まず選ばせる。

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
    state: EditorState.create({ doc: loaded.doc, plugins: editorPlugins({ onSave: () => {} }) }),
  });
  open = { view, place };
  return { view, out: () => toMarkdown(view.state.doc, loaded) };
}

const press = (view: EditorView, key: string) =>
  !!view.someProp("handleKeyDown", (f) =>
    f(view, new KeyboardEvent("keydown", { key, bubbles: true })),
  );

const put = (view: EditorView, at: number) =>
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));

describe("絵の消し方", () => {
  it("絵の直後の Backspace は、まず絵を選ぶ", () => {
    const at = editor("![](./a.png)\n");
    put(at.view, 2);
    expect(press(at.view, "Backspace")).toBe(true);
    expect(at.view.state.selection).toBeInstanceOf(NodeSelection);
    // まだ消えていない。
    expect(at.out()).toBe("![](./a.png)\n");
  });

  it("選んだあとの二打目で消える", () => {
    const at = editor("![](./a.png)\n");
    put(at.view, 2);
    press(at.view, "Backspace");
    press(at.view, "Backspace");
    expect(at.out()).not.toContain("![](./a.png)");
  });

  it("字の後ろでは横取りしない", () => {
    const at = editor("あい\n");
    put(at.view, 3);
    expect(press(at.view, "Backspace")).toBe(false);
  });

  it("塊の頭では横取りしない（手前へ継ぐ動きを潰さない）", () => {
    const at = editor("![](./a.png)\n\n次\n");
    // 「次」の段落の先頭
    const size = at.view.state.doc.content.size;
    put(at.view, size - 2);
    expect(at.view.state.selection.$head.parentOffset).toBe(0);
    press(at.view, "Backspace");
    // 絵を選ぶのではなく、今までどおり手前へ継ぐ。
    expect(at.view.state.selection).not.toBeInstanceOf(NodeSelection);
    expect(at.out()).toContain("![](./a.png)");
  });

  it("前へ消すときも、まず絵を選ぶ", () => {
    const at = editor("![](./a.png)\n");
    put(at.view, 1);
    expect(press(at.view, "Delete")).toBe(true);
    expect(at.view.state.selection).toBeInstanceOf(NodeSelection);
    expect(at.out()).toBe("![](./a.png)\n");
  });

  it("字と混ざっていても、絵の直後なら選ぶ", () => {
    const at = editor("k![](./a.png)\n");
    put(at.view, 3);
    expect(press(at.view, "Backspace")).toBe(true);
    expect(at.view.state.selection).toBeInstanceOf(NodeSelection);
  });
});

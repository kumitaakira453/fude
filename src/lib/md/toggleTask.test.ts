// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// ⌘⏎ でチェックを入れ替える。タスクでなければ行の中の改行のまま。

const noRects = () => [] as unknown as DOMRectList;
const noRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
if (!Element.prototype.getClientRects) Element.prototype.getClientRects = noRects;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = noRect;

let open: { view: EditorView; loaded: Loaded; place: HTMLElement } | null = null;

function editor(body: string) {
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({
      doc: loaded.doc,
      plugins: editorPlugins({ onSave: () => {} }),
    }),
  });
  open = { view, loaded, place };
  return view;
}

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
});

function caretIn(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isTextblock && node.textContent === text) at = pos + 1 + node.content.size;
    return at < 0;
  });
  if (at < 0) throw new Error(`見つからない: ${text}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

// jsdom は Mac と見なされないので、Mod は Ctrl で届く。
function press(view: EditorView) {
  const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true });
  return view.someProp("handleKeyDown", (f) => f(view, event)) ?? false;
}

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);

describe("⌘⏎ でチェックを入れ替える", () => {
  it("未了を済みにし、もう一度で戻す", () => {
    const view = editor("- [ ] やる\n");
    caretIn(view, "やる");
    expect(press(view)).toBe(true);
    expect(source()).toBe("- [x] やる\n");
    expect(press(view)).toBe(true);
    expect(source()).toBe("- [ ] やる\n");
  });

  it("入れ子のタスクは、カーソルの居る項目だけ変わる", () => {
    const view = editor("- [ ] 親\n  - [ ] 子\n");
    caretIn(view, "子");
    press(view);
    expect(source()).toBe("- [ ] 親\n  - [x] 子\n");
  });

  it("タスクでない項目では行の中の改行になる", () => {
    const view = editor("- ただの項目\n");
    caretIn(view, "ただの項目");
    expect(press(view)).toBe(true);
    expect(source()).toBe("- ただの項目\\\n");
  });

  it("段落でも行の中の改行のまま", () => {
    const view = editor("あ\n");
    caretIn(view, "あ");
    expect(press(view)).toBe(true);
    expect(source()).toBe("あ\\\n");
  });
});

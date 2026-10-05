// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 引用の中で Enter を押して割り、Backspace で引用の外へ出す。編集面をそのまま
// 組んで、鍵の並びごと試す。

const noRects = () => [] as unknown as DOMRectList;
const noRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
if (!Element.prototype.getClientRects) Element.prototype.getClientRects = noRects;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = noRect;

let open: { view: EditorView; loaded: Loaded; place: HTMLElement } | null = null;

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
    state: EditorState.create({
      doc: loaded.doc,
      plugins: editorPlugins({ onSave: () => {} }),
    }),
  });
  open = { view, loaded, place };
  return view;
}

// mark の字の直後にカーソルを置く。
function caretAfter(view: EditorView, mark: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(mark)) {
      at = pos + node.text!.indexOf(mark) + mark.length;
    }
  });
  if (at < 0) throw new Error(`見つからない: ${mark}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

function press(view: EditorView, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true });
  return view.someProp("handleKeyDown", (f) => f(view, event)) ?? false;
}

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);

// 段落の中の改行は空白として並ぶ。
const QUOTE = "> 合っていますか？\n付与する値です。\n\n次\n";

describe("引用の中で割って外へ出す", () => {
  it("改行の直後で割ると、新しい行は空白から始まらない", () => {
    const view = editor(QUOTE);
    caretAfter(view, "？");
    expect(press(view, "Enter")).toBe(true);
    expect(view.state.selection.$from.parent.textContent).toBe("付与する値です。");
  });

  it("割った行の頭で Backspace を押すと、その行が引用の外へ出る", () => {
    const view = editor(QUOTE);
    caretAfter(view, "？");
    press(view, "Enter");
    expect(press(view, "Backspace")).toBe(true);
    expect(source()).toBe("> 合っていますか？\n\n付与する値です。\n\n次\n");
  });

  it("後ろに続く行は引用に残る", () => {
    const view = editor("> 一\n>\n> 二\n>\n> 三\n");
    let two = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "二") two = pos + 1;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, two)));
    press(view, "Backspace");
    expect(source()).toBe("> 一\n\n二\n\n> 三\n");
  });

  it("callout の中では手前の段落へ継ぐ", () => {
    const view = editor("> [!NOTE]\n> 一\n>\n> 二\n");
    let two = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "二") two = pos + 1;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, two)));
    press(view, "Backspace");
    expect(view.state.doc.child(0).type.name).toBe("blockquote");
    expect(view.state.doc.childCount).toBe(1);
  });
});

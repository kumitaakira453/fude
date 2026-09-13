// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 変換の最中に流れてくる打鍵を、手に渡さない。
//
// prosemirror-view は本文と DOM の差分が「Enter を押した形」に見えると、
// Enter の手を流し直す。WebKit は変換を確定するとき変換中の字をいったん
// 消すので、その差分がちょうどその形になる。流し直された Enter で項目を
// 割ると、IME が抱えている字が本文から外れ、確定の分と合わせて二重に残る。
//
// 実際の打鍵は変換中には届かない（prosemirror-view が先に捨てる）。

const noRects = () => [] as unknown as DOMRectList;
const noRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
if (!Element.prototype.getClientRects) Element.prototype.getClientRects = noRects;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = noRect;

interface Inner {
  input?: { composing: boolean };
}

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

function caretAtEndOf(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isTextblock && node.textContent === text) at = pos + 1 + node.content.size;
    return at < 0;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

// 編集面が差分から作る打鍵は KeyboardEvent ではなく素の Event。同じ形で流す。
function fakeEnter(view: EditorView) {
  const event = document.createEvent("Event");
  event.initEvent("keydown", true, true);
  Object.assign(event, { keyCode: 13, key: "Enter", code: "Enter" });
  return view.someProp("handleKeyDown", (f) => f(view, event as KeyboardEvent)) ?? false;
}

const composing = (view: EditorView, on: boolean) => {
  const input = (view as EditorView & Inner).input;
  if (input) input.composing = on;
};

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);

describe("変換の最中に流れてくる打鍵", () => {
  it("変換中の Enter は手に渡さない。本文も動かない", () => {
    const view = editor("- [ ] あ\n");
    caretAtEndOf(view, "あ");
    composing(view, true);
    expect(fakeEnter(view)).toBe(false);
    expect(source()).toBe("- [ ] あ\n");
  });

  it("変換が終わっていれば、いつもどおり項目を割る", () => {
    const view = editor("- [ ] あ\n");
    caretAtEndOf(view, "あ");
    composing(view, false);
    expect(fakeEnter(view)).toBe(true);
    expect(source()).toBe("- [ ] あ\n- [ ]\n");
  });

  it("段落でも変換中は割らない", () => {
    const view = editor("あ\n");
    caretAtEndOf(view, "あ");
    composing(view, true);
    expect(fakeEnter(view)).toBe(false);
    expect(source()).toBe("あ\n");
  });

  it("変換中は字下げも効かない（Tab も差分から流れてくる）", () => {
    const view = editor("- 一つ\n- 二つ\n");
    caretAtEndOf(view, "二つ");
    composing(view, true);
    const event = document.createEvent("Event");
    event.initEvent("keydown", true, true);
    Object.assign(event, { keyCode: 9, key: "Tab", code: "Tab" });
    expect(
      view.someProp("handleKeyDown", (f) => f(view, event as KeyboardEvent)) ?? false,
    ).toBe(false);
    expect(source()).toBe("- 一つ\n- 二つ\n");
  });
});

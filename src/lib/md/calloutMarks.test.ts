// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { nodeViews } from "./nodeViews";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 編集面の囲み（> [!IMPORTANT] など）。読む画面と同じ絵・見出し・色で描き、
// 中身はふつうに打てる。目印の字は、その段落に入ったときだけ出す。

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
    state: EditorState.create({ doc: loaded.doc, plugins: editorPlugins({ onSave: () => {} }) }),
    nodeViews: nodeViews({ dark: false, modes: new Map(), redraws: new Set() }),
  });
  open = { view, loaded, place };
  return view;
}

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
});

const SRC = "前\n\n> [!IMPORTANT]\n> 大事な話。\n\n後\n";

// 位置の文字を探して、その直前にカーソルを置く。
function caretAt(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text);
    return at < 0;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
  return at;
}

const mark = (view: EditorView) => view.dom.querySelector<HTMLElement>(".mg-callout-mark");

describe("編集面の囲み", () => {
  it("読む画面と同じ囲み（見出し・種類の色）で描く", () => {
    const view = editor(SRC);
    const box = view.dom.querySelector(".mg-callout.important")!;
    expect(box).not.toBeNull();
    expect(box.querySelector(".mg-callout-k")!.textContent).toBe("Important");
    expect(view.dom.querySelector("blockquote")).toBeNull();
  });

  it("目印は段落の外では隠し、目印のある段落に入ると出す", () => {
    const view = editor(SRC);
    caretAt(view, "前");
    expect(mark(view)!.classList.contains("is-hidden")).toBe(true);
    expect(mark(view)!.textContent).toContain("[!IMPORTANT]");
    caretAt(view, "大事");
    expect(mark(view)!.classList.contains("is-hidden")).toBe(false);
  });

  it("中身はふつうに打てて、囲みのまま残る", () => {
    const view = editor(SRC);
    const at = caretAt(view, "話");
    view.dispatch(view.state.tr.insertText("な", at));
    expect(view.dom.querySelector(".mg-callout.important")!.textContent).toContain("大事なな話。");
    expect(toMarkdown(view.state.doc, open!.loaded)).toContain("> 大事なな話。");
  });

  it("目印を打ち替えると種類が替わり、消すとふつうの引用に戻る", () => {
    const view = editor(SRC);
    const at = caretAt(view, "IMPORTANT");
    view.dispatch(view.state.tr.insertText("TIP", at, at + "IMPORTANT".length));
    expect(view.dom.querySelector(".mg-callout.tip")).not.toBeNull();
    const start = caretAt(view, "[!TIP]");
    view.dispatch(view.state.tr.delete(start, start + "[!TIP]".length));
    expect(view.dom.querySelector(".mg-callout")).toBeNull();
    expect(view.dom.querySelector("blockquote")).not.toBeNull();
  });

  it("触らなければ原文のまま書き戻す", () => {
    const view = editor(SRC);
    expect(toMarkdown(view.state.doc, open!.loaded)).toBe(SRC);
  });
});

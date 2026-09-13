// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 中身のある項目の先頭で Backspace を続けて押す。編集面をそのまま組んで、
// 鍵の並びごと試す。
//
//   1 回目 … 点が外れて、その場に段落として残る
//   2 回目 … 前の項目の末尾へ文がつながり、並びは一つに戻る

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

// text の行の先頭にカーソルを置く。
function head(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isTextblock && node.textContent === text) at = pos + 1;
    return at < 0;
  });
  if (at < 0) throw new Error(`見つからない: ${text}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

function back(view: EditorView) {
  const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
  return view.someProp("handleKeyDown", (f) => f(view, event)) ?? false;
}

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);
const lists = () => {
  let n = 0;
  open!.view.state.doc.forEach((node) => {
    if (node.type.name === "bulletList" || node.type.name === "orderedList") n++;
  });
  return n;
};

describe("中身のある項目で Backspace を続けて押す", () => {
  it("1 回目は点が外れて、その場に段落が残る", () => {
    const view = editor("- あ\n- かき\n- く\n");
    head(view, "かき");
    expect(back(view)).toBe(true);
    expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(view.state.selection.$from.node(-1).type.name).toBe("doc");
    expect(source()).toBe("- あ\n\nかき\n\n- く\n");
  });

  it("2 回目で前の項目の末尾へ継ぎ、並びは一つになる", () => {
    const view = editor("- あ\n- かき\n- く\n");
    head(view, "かき");
    back(view);
    expect(back(view)).toBe(true);
    expect(source()).toBe("- あかき\n- く\n");
    expect(lists()).toBe(1);
    // 継ぎ目。ここから打てば「あ」と「かき」の間に入る。
    expect(view.state.selection.$from.parent.textContent).toBe("あかき");
    expect(view.state.selection.$from.parentOffset).toBe(1);
  });

  it("番号付きでも同じ", () => {
    const view = editor("1. 一つ\n2. 二つ\n3. 三つ\n");
    head(view, "二つ");
    back(view);
    back(view);
    expect(source()).toBe("1. 一つ二つ\n2. 三つ\n");
    expect(lists()).toBe(1);
  });

  it("入れ子は 1 段ずつ浅くしてから継ぐ。継ぎ先は直前の行", () => {
    const view = editor("- 一つ\n  - 中\n  - 奥\n");
    head(view, "奥");
    // 入れ子は外れるまでに 2 回かかる（1 段浅く → 並びを抜ける）。
    back(view);
    back(view);
    back(view);
    expect(source()).toBe("- 一つ\n  - 中奥\n");
    expect(lists()).toBe(1);
  });

  it("最後の項目でも同じ。並びが 1 つに保たれる", () => {
    const view = editor("- あ\n- かき\n");
    head(view, "かき");
    back(view);
    back(view);
    expect(source()).toBe("- あかき\n");
    expect(lists()).toBe(1);
  });

  it("並びの手前に無い段落は継がない", () => {
    const view = editor("前の段落\n\n後の段落\n");
    head(view, "後の段落");
    back(view);
    expect(source()).toBe("前の段落後の段落\n");
  });
});

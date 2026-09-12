// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 中身を消した項目の先頭で Backspace を続けて押す。編集面をそのまま組んで、
// 鍵の並びごと試す。
//
//   1 回目 … 点が外れて、その場に空の行が残る
//   2 回目 … 空の行が消えて、前の項目の末尾へ。並びは一つに戻る

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

// text の行を空にして、その先頭にカーソルを置く。
function clear(view: EditorView, text: string) {
  let from = -1;
  let to = -1;
  view.state.doc.descendants((node, pos) => {
    if (from >= 0) return false;
    if (!node.isTextblock) return true;
    if (node.textContent === text) {
      from = pos + 1;
      to = from + node.content.size;
    }
    return from < 0;
  });
  if (from < 0) throw new Error(`見つからない: ${text}`);
  const tr = view.state.tr.delete(from, to);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from)));
}

function back(view: EditorView) {
  const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
  return view.someProp("handleKeyDown", (f) => f(view, event)) ?? false;
}

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);
// 並びの数。二つに割れていないことを、原文の読み方に頼らずに見る。
const lists = () => {
  let n = 0;
  open!.view.state.doc.forEach((node) => {
    if (node.type.name === "bulletList" || node.type.name === "orderedList") n++;
  });
  return n;
};

const LIST = `- あ
- がが
- なか
- リスト
`;

describe("空にした項目で Backspace を続けて押す", () => {
  it("1 回目は点が外れて、その場に空の行が残る", () => {
    const view = editor(LIST);
    clear(view, "なか");
    expect(back(view)).toBe(true);
    expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(view.state.selection.$from.node(-1).type.name).toBe("doc");
  });

  it("2 回目で前の項目の末尾へ戻り、並びは一つになる", () => {
    const view = editor(LIST);
    clear(view, "なか");
    back(view);
    expect(back(view)).toBe(true);
    expect(source()).toBe(`- あ
- がが
- リスト
`);
    expect(lists()).toBe(1);
    // 「がが」の末尾。ここから打てば前の項目の続きになる。
    expect(view.state.selection.$from.parent.textContent).toBe("がが");
    expect(view.state.selection.$from.parentOffset).toBe(2);
  });

  it("番号付きは番号が続きのまま詰まる", () => {
    const view = editor("1. 一つ\n2. 二つ\n3. 三つ\n");
    clear(view, "二つ");
    back(view);
    back(view);
    expect(source()).toBe("1. 一つ\n2. 三つ\n");
    expect(lists()).toBe(1);
  });

  it("入れ子は 1 段浅くしてから外れる。並びは割れたままにならない", () => {
    const view = editor(`- 一つ
  - 中
  - 奥
  - 隅
`);
    clear(view, "奥");
    // 入れ子では 1 回目が 1 段浅くするのに使われるので、外れるのは 2 回目。
    back(view);
    back(view);
    back(view);
    expect(source()).toBe(`- 一つ
  - 中
- 隅
`);
    expect(lists()).toBe(1);
  });

  it("段落どうしは繋がない", () => {
    const view = editor("前の段落\n\nなか\n\n後の段落\n");
    clear(view, "なか");
    expect(back(view)).toBe(true);
    expect(source()).toBe("前の段落\n\n後の段落\n");
  });

  it("並びの種類が違うなら繋がない", () => {
    const view = editor("- あ\n\nなか\n\n1. いち\n");
    clear(view, "なか");
    back(view);
    expect(source()).toBe("- あ\n\n1. いち\n");
  });
});

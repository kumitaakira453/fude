// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { schema } from "./schema";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 行内の装飾の継ぎ方を、編集面をそのまま組み立てて試す。

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

function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const took = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (!took) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

function press(view: EditorView, key: string, mods: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, ...mods });
  return view.someProp("handleKeyDown", (f) => f(view, event)) ?? false;
}

// 直前の 1 文字を消す。装飾の末尾では keymap が受け取るので、まずそちらへ渡す。
// 受けなければブラウザが直に消し、ProseMirror が書き換わった DOM を読み直して
// 同じ形の transaction を組む（消した範囲の装飾を控えに置く）。その経路を真似る。
function erase(view: EditorView) {
  if (press(view, "Backspace")) return;
  const { from } = view.state.selection;
  const marks = view.state.doc.resolve(from - 1).marksAcross(view.state.doc.resolve(from));
  const tr = view.state.tr.delete(from - 1, from);
  if (marks) tr.ensureMarks(marks);
  view.dispatch(tr);
}

// 行内コードの末尾へカーソルを置く。
function caretAfterCode(view: EditorView) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && schema.marks.code.isInSet(node.marks)) at = pos + node.nodeSize;
  });
  if (at < 0) throw new Error("行内コードが無い");
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

function caretAtEndOf(view: EditorView, nth: number) {
  let seen = 0;
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    if (seen++ === nth) at = pos + 1 + node.content.size;
  });
  if (at < 0) throw new Error("文字塊が足りない");
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);

// 画面に出ている行内コードの囲みの数。角丸の背景はこの要素ごとに付く。
const codes = () => open!.view.dom.querySelectorAll("code").length;

describe("行内コードの末尾で打ち直す", () => {
  it("素の行内コードは 1 つの囲みのまま", () => {
    const view = editor("`a.md` を見る\n");
    caretAfterCode(view);
    erase(view);
    type(view, "d");
    expect(source()).toBe("`a.md` を見る\n");
    expect(codes()).toBe(1);
  });

  it("リンクの中の行内コードも 1 つの囲みのまま", () => {
    const view = editor("[`a.md`](./a.md) を見る\n");
    caretAfterCode(view);
    erase(view);
    type(view, "d");
    expect(source()).toBe("[`a.md`](./a.md) を見る\n");
    expect(codes()).toBe(1);
  });

  it("段落の末尾にあるリンクの中でも 1 つの囲みのまま", () => {
    const view = editor("[`a.md`](./a.md)\n");
    caretAtEndOf(view, 0);
    erase(view);
    type(view, "d");
    expect(source()).toBe("[`a.md`](./a.md)\n");
    expect(codes()).toBe(1);
  });

  it("リンクだけで囲った文字の末尾で打った字はリンクの外", () => {
    const view = editor("[題](./a.md)\n");
    caretAtEndOf(view, 0);
    type(view, "字");
    expect(source()).toBe("[題](./a.md)字\n");
  });

  it("リンクの中の太字の末尾で打った字もリンクの中", () => {
    const view = editor("[**強い**](./a.md)\n");
    caretAtEndOf(view, 0);
    type(view, "字");
    expect(source()).toBe("[**強い字**](./a.md)\n");
  });

  it("絵文字を消しても割れない", () => {
    const view = editor("`a🎈` を見る\n");
    caretAfterCode(view);
    erase(view);
    type(view, "b");
    expect(source()).toBe("`ab` を見る\n");
  });
});

describe("行内コードから抜ける", () => {
  it("囲みの直後に打った字は外へ出る", () => {
    const view = editor("`Log`\n");
    caretAtEndOf(view, 0);
    type(view, "日本語");
    expect(source()).toBe("`Log`日本語\n");
    expect(codes()).toBe(1);
  });

  it("リンクの中の囲みの直後でも、リンクごと抜ける", () => {
    const view = editor("[`a.md`](./a.md)\n");
    caretAtEndOf(view, 0);
    type(view, "を見る");
    expect(source()).toBe("[`a.md`](./a.md)を見る\n");
    expect(codes()).toBe(1);
  });

  it("太字は直後に打っても続く", () => {
    const view = editor("**強い**\n");
    caretAtEndOf(view, 0);
    type(view, "字");
    expect(source()).toBe("**強い字**\n");
  });

  it("囲みと抜けた字をまとめて選んで ⌘⇧C を押すと、全部が囲みに入る", () => {
    const view = editor("`a.m`\n");
    caretAtEndOf(view, 0);
    type(view, "d");
    // 囲みの中と外をまたいで選ぶ。
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1),
      ),
    );
    expect(press(view, "c", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(source()).toBe("`a.md`\n");
    expect(codes()).toBe(1);
  });

  it("丸ごと囲みの範囲を選んで ⌘⇧C を押すと外れる", () => {
    const view = editor("`a.md`\n");
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1),
      ),
    );
    expect(press(view, "c", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(source()).toBe("a.md\n");
    expect(codes()).toBe(0);
  });

  it("丸ごと太字の範囲を選んで ⌘B を押すと外れる", () => {
    const view = editor("**強い**\n");
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1),
      ),
    );
    expect(press(view, "b", { ctrlKey: true })).toBe(true);
    expect(source()).toBe("強い\n");
  });

  // リンクの内と外の行内コードは、原文では別のものとしか書けない。リンクの
  // ラベルを直したいときは、消して打ち直すほうを使う（リンクごと保たれる）。
  it("リンクの内と外にまたがって付けると、囲みは分かれる", () => {
    const view = editor("[`a.m`](./a.md)\n");
    caretAtEndOf(view, 0);
    type(view, "d");
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1),
      ),
    );
    expect(press(view, "c", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(source()).toBe("[`a.m`](./a.md)`d`\n");
    expect(codes()).toBe(2);
  });

  it("抜けたあとの字を選んで ⌘⇧C を押すと囲みが伸びる", () => {
    const view = editor("`a.m`\n");
    caretAtEndOf(view, 0);
    type(view, "d");
    // 打った "d" を選び直して付ける。
    const end = view.state.doc.content.size - 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end - 1, end)));
    expect(press(view, "c", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(source()).toBe("`a.md`\n");
    expect(codes()).toBe(1);
  });
});

describe("2 つに割れた行内コードを直す", () => {
  // prosemirror-keymap は小文字で照合する（実機では keyCode から引き直すが、
  // 作った event には keyCode が無い）。
  const mod = (view: EditorView, key: string, shift = false) =>
    press(view, key, { ctrlKey: true, shiftKey: shift });

  const split = "[`a.m`](./a.md)`d`\n";

  it("割れた原文は囲みが 2 つ並ぶ", () => {
    editor(split);
    expect(codes()).toBe(2);
  });

  it("⌘⇧C で並んだ囲みがまとめて外れる", () => {
    const view = editor(split);
    caretAtEndOf(view, 0);
    expect(mod(view, "c", true)).toBe(true);
    expect(codes()).toBe(0);
    expect(source()).toBe("[a.m](./a.md)d\n");
  });

  it("末尾の 1 文字を消して打ち直すと 1 つに戻る", () => {
    const view = editor(split);
    caretAtEndOf(view, 0);
    erase(view);
    type(view, "d");
    expect(codes()).toBe(1);
    expect(source()).toBe("[`a.md`](./a.md)\n");
  });
});

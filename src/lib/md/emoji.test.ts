// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEmoji } from "../emoji";
import { closeEmoji, emojiKey, openEmojiBoard, takeEmoji } from "./emoji";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// ":" から絵文字を出す仕掛け。打鍵を横取りする条件と、閉じる条件が肝。

const noRects = () => [] as unknown as DOMRectList;
const noRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;

beforeAll(async () => {
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = noRects;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = noRect;
  }
  // Enter で決めるには一覧が読めている必要がある。
  await loadEmoji();
});

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

// ProseMirror と同じ形で打鍵を配る。
//
// press の返り値は「どれかのプラグインが取った」を意味するだけ（keymap も
// Enter を持っている）。絵文字の仕掛けが取ったかどうかは、本文と控えの
// 変わり方で見る。
function type(view: EditorView, text: string) {
  const { from, to } = view.state.selection;
  const taken = view.someProp("handleTextInput", (f) =>
    f(view, from, to, text, () => view.state.tr.insertText(text, from, to)),
  );
  if (!taken) view.dispatch(view.state.tr.insertText(text, from, to));
}

function press(view: EditorView, key: string): boolean {
  return (
    view.someProp("handleKeyDown", (f) =>
      f(view, new KeyboardEvent("keydown", { key })),
    ) ?? false
  );
}

function caretAt(view: EditorView, pos: number) {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );
}

const state = (view: EditorView) => emojiKey.getState(view.state);

describe("`:` で開く", () => {
  it("行頭で打つと開く", () => {
    const view = editor("\n");
    caretAt(view, 1);
    type(view, ":");
    expect(state(view)).not.toBe(null);
    expect(state(view)?.query).toBe("");
  });

  it("日本語の後ろでも開く", () => {
    const view = editor("あ\n");
    caretAt(view, 2);
    type(view, ":");
    expect(state(view)).not.toBe(null);
  });

  it("英数字の後ろでは開かない（12:30 や http:// で邪魔しない）", () => {
    const view = editor("12\n");
    caretAt(view, 3);
    type(view, ":");
    expect(state(view)).toBe(null);
    // 文字としては入る。
    expect(view.state.doc.textBetween(1, 4)).toBe("12:");
  });

  it("すでに : の後ろでは開かない（http:// の 2 つめ）", () => {
    const view = editor("あ\n");
    caretAt(view, 2);
    type(view, ":");
    expect(press(view, "Escape")).toBe(true);
    type(view, ":");
    expect(state(view)).toBe(null);
  });

  it("続けて打った文字が絞り込みになる", () => {
    const view = editor("\n");
    caretAt(view, 1);
    type(view, ":");
    type(view, "b");
    type(view, "u");
    expect(state(view)?.query).toBe("bu");
  });

  it("空白まで打つと閉じる", () => {
    const view = editor("\n");
    caretAt(view, 1);
    type(view, ":");
    type(view, "b");
    type(view, " ");
    expect(state(view)).toBe(null);
  });

  it("Escape で閉じる。打った文字は本文に残る", () => {
    const view = editor("\n");
    caretAt(view, 1);
    type(view, ":");
    type(view, "b");
    expect(press(view, "Escape")).toBe(true);
    expect(state(view)).toBe(null);
    expect(view.state.doc.textBetween(1, 3)).toBe(":b");
  });

  it("矢印で候補を送る", () => {
    const view = editor("\n");
    caretAt(view, 1);
    type(view, ":");
    expect(press(view, "ArrowRight")).toBe(true);
    expect(state(view)?.active).toBe(1);
    expect(press(view, "ArrowDown")).toBe(true);
    expect(state(view)?.active).toBe(11);
    expect(press(view, "ArrowUp")).toBe(true);
    expect(state(view)?.active).toBe(1);
  });
});

describe("決める", () => {
  it("Enter で `:xxx` が消えて絵文字が入る", () => {
    const view = editor("あ\n");
    caretAt(view, 2);
    type(view, ":");
    for (const ch of "bulb") type(view, ch);
    expect(state(view)?.query).toBe("bulb");
    expect(press(view, "Enter")).toBe(true);
    expect(state(view)).toBe(null);
    expect(toMarkdown(view.state.doc, open!.loaded)).toBe("あ💡\n");
  });

  it("押して決めても同じ", () => {
    const view = editor("\n");
    caretAt(view, 1);
    type(view, ":");
    for (const ch of "bulb") type(view, ch);
    takeEmoji(view, "🔥");
    expect(toMarkdown(view.state.doc, open!.loaded)).toBe("🔥\n");
  });

  it("当たらない語では絵文字を入れない", () => {
    const view = editor("あ\n");
    caretAt(view, 2);
    type(view, ":");
    for (const ch of "zzqq") type(view, ch);
    press(view, "Enter");
    // 打った文字はそのまま。決め打ちで何かを入れたりしない。
    expect(view.state.doc.textContent).toContain(":zzqq");
  });
});

describe("/emoji から開く", () => {
  it("本文を変えずに開き、閉じても本文は変わらない", () => {
    const view = editor("あ\n");
    caretAt(view, 2);
    openEmojiBoard(view);
    expect(state(view)?.bare).toBe(true);
    closeEmoji(view);
    expect(state(view)).toBe(null);
    expect(toMarkdown(view.state.doc, open!.loaded)).toBe("あ\n");
  });

  it("決めるとカーソルの位置に入る（`:` は消さない）", () => {
    const view = editor("あ\n");
    caretAt(view, 2);
    openEmojiBoard(view);
    takeEmoji(view, "💡");
    expect(toMarkdown(view.state.doc, open!.loaded)).toBe("あ💡\n");
  });

  it("Enter は改行に譲る（決める相手が無い）", () => {
    const view = editor("あ\n");
    caretAt(view, 2);
    openEmojiBoard(view);
    const was = view.state.doc.childCount;
    press(view, "Enter");
    expect(view.state.doc.childCount).toBe(was + 1);
  });
});

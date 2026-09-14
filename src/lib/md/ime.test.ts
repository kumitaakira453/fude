// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { schema } from "./schema";
import { toMarkdown } from "./toMarkdown";

// prosemirror-view が「変換が終わった時刻」を控える欄。ここを戻すと、確定の
// 直後の打鍵が捨てられなくなる。-2e8 が「ずっと前に終わった」＝捨てない印。
interface Inner {
  input?: { compositionEndedAt: number };
}
const endedAt = (view: EditorView) => (view as EditorView & Inner).input?.compositionEndedAt;
const dropping = (view: EditorView) => endedAt(view) !== -2e8;

let open: { view: EditorView; place: HTMLElement } | null = null;

function editor(body = "- あ\n") {
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({ doc: loaded.doc, plugins: editorPlugins({ onSave: () => {} }) }),
  });
  open = { view, place };
  return view;
}

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
});

const send = (view: EditorView, type: "compositionstart" | "compositionend") =>
  view.dom.dispatchEvent(new CompositionEvent(type, { bubbles: true }));

const up = (view: EditorView, init: KeyboardEventInit = {}) =>
  view.dom.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, ...init }));

describe("変換を確定した直後の打鍵", () => {
  it("確定の知らせだけでは窓を閉じない", () => {
    const view = editor();
    send(view, "compositionstart");
    send(view, "compositionend");
    expect(dropping(view)).toBe(true);
  });

  it("確定に使ったキーを離したら窓を閉じる", () => {
    const view = editor();
    send(view, "compositionstart");
    send(view, "compositionend");
    up(view);
    expect(dropping(view)).toBe(false);
  });

  it("変換中に離した分は数えない", () => {
    const view = editor();
    send(view, "compositionstart");
    up(view);
    send(view, "compositionend");
    expect(dropping(view)).toBe(true);
    up(view);
    expect(dropping(view)).toBe(false);
  });

  it("変換中の印が付いた打鍵では閉じない", () => {
    const view = editor();
    send(view, "compositionstart");
    send(view, "compositionend");
    up(view, { keyCode: 229 });
    expect(dropping(view)).toBe(true);
    up(view, { isComposing: true });
    expect(dropping(view)).toBe(true);
    up(view);
    expect(dropping(view)).toBe(false);
  });

  it("控えの欄がある。名前が変わったらここで気づく", () => {
    const view = editor();
    expect(typeof endedAt(view)).toBe("number");
  });
});

// 変換の確定で、WebKit は器ごと DOM を作り替える。
//
// 見出しの中身が変換中の字だけだと、確定のときに <h2> が
// <p><b>…</b><br></p> に置き換わる（deleteCompositionText は
// cancelable: false で止められない）。prosemirror はそれを差分として読み、
// 本文の見出しを段落へ落とす。落ちる前の塊は既に確定後と同じ中身なので、
// その塊で置き直せば器も飾りも元へ戻る。
describe("変換の確定で器が作り替えられたとき", () => {
  // WebKit が作り替えた DOM を読んだ結果と同じ差し替えを流す。
  const asWebkit = (view: EditorView, text: string) => {
    const at = view.state.selection.$from;
    const from = at.before();
    const fake = schema.nodes.paragraph.create(null, [
      schema.text(text, [schema.marks.strong.create()]),
      schema.nodes.hardBreak.create(),
    ]);
    view.dispatch(view.state.tr.replaceWith(from, at.after(), fake));
  };

  const caretEnd = (view: EditorView) => {
    const at = view.state.doc.child(0).nodeSize - 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
  };

  it("見出しは見出しのまま残る", () => {
    const view = editor("## こんにちは\n");
    caretEnd(view);
    send(view, "compositionstart");
    send(view, "compositionend");
    asWebkit(view, "こんにちは");
    const head = view.state.doc.child(0);
    expect(head.type.name).toBe("heading");
    expect(head.attrs.level).toBe(2);
    expect(head.textContent).toBe("こんにちは");
  });

  it("足された飾りと改行も残らない", () => {
    const view = editor("## こんにちは\n");
    caretEnd(view);
    send(view, "compositionstart");
    send(view, "compositionend");
    asWebkit(view, "こんにちは");
    expect(toMarkdown(view.state.doc, fromMarkdown("## こんにちは\n"))).toBe("## こんにちは\n");
  });

  it("項目でも器が残る", () => {
    const view = editor("- [ ] やる\n");
    caretEnd(view);
    send(view, "compositionstart");
    send(view, "compositionend");
    asWebkit(view, "やる");
    const item = view.state.doc.child(0).child(0);
    expect(item.type.name).toBe("listItem");
    expect(item.attrs.checked).toBe(false);
  });

  it("変換と関わりのないときは手を出さない", () => {
    const view = editor("## こんにちは\n");
    caretEnd(view);
    asWebkit(view, "こんにちは");
    expect(view.state.doc.child(0).type.name).toBe("paragraph");
  });

  it("字の入れ替えだけなら通す", () => {
    const view = editor("## こんにちは\n");
    caretEnd(view);
    send(view, "compositionstart");
    send(view, "compositionend");
    const at = view.state.selection.from;
    view.dispatch(view.state.tr.insertText("！", at));
    expect(view.state.doc.child(0).textContent).toBe("こんにちは！");
  });
});

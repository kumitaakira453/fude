// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins } from "./plugins";

// prosemirror-view が「変換が終わった時刻」を控える欄。ここを戻すと、確定の
// 直後の打鍵が捨てられなくなる。-2e8 が「ずっと前に終わった」＝捨てない印。
interface Inner {
  input?: { compositionEndedAt: number };
}
const endedAt = (view: EditorView) => (view as EditorView & Inner).input?.compositionEndedAt;
const dropping = (view: EditorView) => endedAt(view) !== -2e8;

let open: { view: EditorView; place: HTMLElement } | null = null;

function editor() {
  const loaded = fromMarkdown("- あ\n");
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

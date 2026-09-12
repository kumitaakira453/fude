// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins } from "./plugins";

// prosemirror-view が「変換が終わった時刻」を控える欄。ここを早めに戻すことで、
// 確定の直後の打鍵が捨てられなくなる。
interface Inner {
  input?: { compositionEndedAt: number };
}
const endedAt = (view: EditorView) => (view as EditorView & Inner).input?.compositionEndedAt;

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
  vi.useRealTimers();
});

describe("変換を確定した直後の打鍵", () => {
  it("確定から少し経ったら、捨てる窓を閉じる", () => {
    vi.useFakeTimers();
    const view = editor();
    view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    expect(endedAt(view)).toBeGreaterThan(-2e8);
    vi.advanceTimersByTime(49);
    expect(endedAt(view)).toBeGreaterThan(-2e8);
    vi.advanceTimersByTime(1);
    expect(endedAt(view)).toBe(-2e8);
  });

  it("控えの欄がある。名前が変わったらここで気づく", () => {
    const view = editor();
    expect(typeof endedAt(view)).toBe("number");
  });
});

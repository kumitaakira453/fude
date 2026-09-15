// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
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
// 中身が変換中の字だけだと、確定のときに <h2> が <p><b>…</b><br></p> に
// 置き換わる（deleteCompositionText は cancelable: false で止められない）。
// prosemirror がそれを差分として読むと、本文の見出しが段落へ落ちる。本文は
// 確定の時点で既に正しいので、溜まった DOM の変化は読まずに捨て、本文から
// 描き直す。
describe("変換の確定のあと", () => {
  const caretEnd = (view: EditorView) => {
    const at = view.state.doc.child(0).nodeSize - 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
  };

  // 溜まっている DOM の変化。jsdom の見張りは知らせが後から来るので、
  // prosemirror と同じやり方（pendingRecords）でいま溜まっている分を数える。
  type Watch = { domObserver?: { pendingRecords(): unknown[]; queue: unknown[] } };
  const kept = (view: EditorView) => {
    const watch = (view as EditorView & Watch).domObserver;
    if (!watch) return -1;
    watch.pendingRecords();
    return watch.queue.length;
  };

  // WebKit が器を作り替えた形。画面だけが変わり、本文は触らない。
  const breakDom = (view: EditorView) => {
    const dom = view.nodeDOM(0);
    if (!(dom instanceof HTMLElement)) throw new Error("塊の DOM が無い");
    const fake = document.createElement("p");
    const bold = document.createElement("b");
    bold.textContent = dom.textContent;
    fake.append(bold, document.createElement("br"));
    dom.replaceWith(fake);
  };

  it("本文は作り替えに引きずられない", () => {
    const view = editor("## こんにちは\n");
    caretEnd(view);
    send(view, "compositionstart");
    breakDom(view);
    send(view, "compositionend");
    const head = view.state.doc.child(0);
    expect(head.type.name).toBe("heading");
    expect(head.attrs.level).toBe(2);
    expect(head.textContent).toBe("こんにちは");
  });

  it("溜まっていた DOM の変化は捨てる", () => {
    const view = editor("## こんにちは\n");
    caretEnd(view);
    send(view, "compositionstart");
    breakDom(view);
    send(view, "compositionend");
    expect(kept(view)).toBe(0);
  });

  it("画面と本文の字が食い違うときは触らない", () => {
    const view = editor("## こんにちは\n");
    caretEnd(view);
    send(view, "compositionstart");
    const dom = view.nodeDOM(0);
    if (dom instanceof HTMLElement) dom.textContent = "まだ入っていない";
    send(view, "compositionend");
    // 捨てていないので、prosemirror がいつもどおり読む。
    expect(kept(view)).toBeGreaterThan(0);
  });

  it("項目でも本文は残る", () => {
    const view = editor("- [ ] やる\n");
    caretEnd(view);
    send(view, "compositionstart");
    breakDom(view);
    send(view, "compositionend");
    const item = view.state.doc.child(0).child(0);
    expect(item.type.name).toBe("listItem");
    expect(item.attrs.checked).toBe(false);
    expect(item.textContent).toBe("やる");
  });

  it("変換の最中には何もしない", () => {
    const view = editor("## こんにちは\n");
    caretEnd(view);
    send(view, "compositionstart");
    breakDom(view);
    // 確定の知らせがまだ来ていない。
    expect(kept(view)).toBeGreaterThan(0);
  });
});

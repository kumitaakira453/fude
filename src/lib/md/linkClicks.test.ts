// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { linkClicks } from "./plugins";

// 編集面のリンクを押したときの振り分け。押下は本物の click を投げて確かめる。
//
// prosemirror の handleClickOn では受けられない。押し下げから離すまでの組と
// 位置の解決が揃ったときにしか呼ばれず、リンクを押しただけでは走らない
// （それで窓の既定の遷移に落ち、アプリの中の道筋まで外のブラウザで開いていた）。

let open: { view: EditorView; place: HTMLElement } | null = null;

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
});

function press(body: string, init: MouseEventInit = {}) {
  const goes = { out: vi.fn(), anchor: vi.fn(), file: vi.fn() };
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({ doc: loaded.doc, plugins: [linkClicks(goes)] }),
  });
  open = { view, place };

  const a = view.dom.querySelector("a") ?? view.dom;
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
  a.dispatchEvent(event);
  return { goes, event, view };
}

describe("編集面のリンクの押下", () => {
  it("外向きは opener へ渡す", () => {
    const { goes } = press("[外](https://example.com/a)\n");
    expect(goes.out).toHaveBeenCalledWith("https://example.com/a");
  });

  it("断片は同じ文書の節へ", () => {
    const { goes } = press("[節](#やり取り)\n");
    expect(goes.anchor).toHaveBeenCalledWith("やり取り");
  });

  it("道筋はファイルを開く側へ", () => {
    const { goes } = press("[版](/レビュー見本/会話の見本.md#版)\n");
    expect(goes.file).toHaveBeenCalledWith("/レビュー見本/会話の見本.md#版");
  });

  it("既定の遷移は止める", () => {
    const { event } = press("[版](/a.md)\n");
    expect(event.defaultPrevented).toBe(true);
  });

  it("⌥ を押しながらなら触らない（字を置きたいとき）", () => {
    const { goes, event } = press("[版](/a.md)\n", { altKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(goes.file).not.toHaveBeenCalled();
  });

  it("リンクでないところは触らない", () => {
    const { goes } = press("素の段落\n");
    expect(goes.out).not.toHaveBeenCalled();
    expect(goes.anchor).not.toHaveBeenCalled();
    expect(goes.file).not.toHaveBeenCalled();
  });

  it("編集面を畳んだら見張りも外す", () => {
    const { goes, view } = press("[版](/a.md)\n");
    const a = view.dom.querySelector("a")!;
    view.destroy();
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(goes.file).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useReview } from "./useReview";

// 読む面で、選んだところを右クリックしたときのメニュー。離したときに出なかった
// 場合でも、右クリックで出し直せる。選んでいなければ OS の一覧のまま。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect(0, 0, 0, 0);
  Range.prototype.getClientRects ??= () => document.createElement("div").getClientRects();
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.getSelection()?.removeAllRanges();
});

let seen: { text: string } | null = null;
function Probe({ content }: { content: HTMLElement }) {
  const review = useReview({ absPath: "/w/a.md", body: "本文", raw: "本文", content, isActive: true });
  seen = review.selection;
  return null;
}

function show() {
  const content = document.createElement("div");
  content.innerHTML = '<p data-mg-block="0">コメントを付ける字</p>';
  document.body.appendChild(content);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={createStore()}>
        <Probe content={content} />
      </Provider>,
    ),
  );
  return content;
}

const rightClick = (el: Element) => {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
};

describe("選んだところの右クリック", () => {
  it("選んでいればメニューを出し、OS の一覧は止める", () => {
    const content = show();
    const text = content.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const e = rightClick(content.querySelector("p")!);
    expect(e.defaultPrevented).toBe(true);
    expect(seen?.text).toBe("コメント");
  });

  it("選んでいなければ OS の一覧を止めない", () => {
    const content = show();
    const e = rightClick(content.querySelector("p")!);
    expect(e.defaultPrevented).toBe(false);
  });
});

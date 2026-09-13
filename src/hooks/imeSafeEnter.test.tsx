// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useImeSafeEnter } from "./useImeSafeEnter";

// 変換の確定に使った Enter を「決定」と取らないための見分け。
//
// WebKit は確定の打鍵を、変換が終わった知らせの**あと**に寄こすことがある。
// そのとき composing も isComposing も false、keyCode も 13 なので、打鍵の
// 中身だけでは新しい Enter と見分けが付かない。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
const took: string[] = [];

function Field() {
  const ime = useImeSafeEnter();
  return (
    <input
      data-testid="field"
      onKeyUp={ime.onKeyUp}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        took.push(ime.isComposing(e) ? "捨てた" : "受けた");
      }}
    />
  );
}

function field() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Field />));
  return host.querySelector("input")!;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  took.length = 0;
});

const down = (el: Element, init: KeyboardEventInit = {}) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...init }));
  });
const up = (el: Element) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  });
const comp = (el: Element, type: "compositionstart" | "compositionend") =>
  act(() => {
    el.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
  });

describe("変換の確定に使った Enter", () => {
  it("変換中の打鍵は捨てる", () => {
    const el = field();
    comp(el, "compositionstart");
    down(el);
    expect(took).toEqual(["捨てた"]);
  });

  it("知らせのあとに届いた確定の打鍵も捨てる", () => {
    const el = field();
    comp(el, "compositionstart");
    comp(el, "compositionend");
    down(el);
    expect(took).toEqual(["捨てた"]);
  });

  it("確定のキーが離れたあとの Enter は受ける", () => {
    const el = field();
    comp(el, "compositionstart");
    comp(el, "compositionend");
    up(el);
    down(el);
    expect(took).toEqual(["受けた"]);
  });

  it("確定の打鍵を捨てたら、続く Enter は受ける", () => {
    const el = field();
    comp(el, "compositionstart");
    comp(el, "compositionend");
    down(el);
    up(el);
    down(el);
    expect(took).toEqual(["捨てた", "受けた"]);
  });

  it("変換を挟まない Enter はそのまま受ける", () => {
    const el = field();
    down(el);
    down(el);
    expect(took).toEqual(["受けた", "受けた"]);
  });

  it("keyCode 229 の打鍵は捨てる", () => {
    const el = field();
    down(el, { keyCode: 229 });
    expect(took).toEqual(["捨てた"]);
  });
});

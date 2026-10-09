// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { docFindOpenAtom, highlightAtom } from "../state/atoms";
import { DocSearchOverlay } from "./DocSearchOverlay";

// ⌘F の窓は、その場で探すためのもの。外を押すか別のファイルへ移ったら、
// 閉じて語も印も残さない。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom に無いもの。印の位置を測り直す合図にだけ使う。
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let page: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  page?.remove();
  root = null;
  host = null;
  page = null;
});

function show(store = createStore()) {
  page = document.createElement("div");
  page.textContent = "本文の字";
  document.body.appendChild(page);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const draw = (path: string, isActive = true) =>
    act(() =>
      root!.render(
        <Provider store={store}>
          <DocSearchOverlay content={page} isActive={isActive} path={path} />
        </Provider>,
      ),
    );
  draw("/本/a.md");
  act(() => {
    store.set(docFindOpenAtom, true);
    // 当たりの位置は jsdom で測れない（Range に getClientRects が無い）ので、
    // 本文に無い語で開く。
    store.set(highlightAtom, {
      term: "見当たらない語",
      caseSensitive: false,
      useRegex: false,
      wholeWord: false,
      nonce: 1,
    });
  });
  return { store, draw };
}

const press = (el: Element) =>
  act(() => {
    // jsdom に PointerEvent は無いので、同じ名前の MouseEvent を投げる。
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });

describe("⌘F の窓", () => {
  it("外を押すと閉じ、語も消す", () => {
    const { store } = show();
    expect(document.querySelector(".mg-find")).not.toBeNull();
    press(page!);
    expect(store.get(docFindOpenAtom)).toBe(false);
    expect(store.get(highlightAtom)).toBeNull();
  });

  it("窓の中を押しても閉じない", () => {
    const { store } = show();
    press(document.querySelector(".mg-find-input")!);
    expect(store.get(docFindOpenAtom)).toBe(true);
  });

  it("別のファイルへ移ると閉じ、語も消す", () => {
    const { store, draw } = show();
    draw("/本/b.md");
    expect(store.get(docFindOpenAtom)).toBe(false);
    expect(store.get(highlightAtom)).toBeNull();
  });

  it("並べた別のペインのファイルが替わっても閉じない", () => {
    const { store, draw } = show();
    draw("/本/a.md", false);
    draw("/本/b.md", false);
    expect(store.get(docFindOpenAtom)).toBe(true);
  });
});

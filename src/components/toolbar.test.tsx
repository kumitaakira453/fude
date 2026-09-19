// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { railAtom, sidebarOpenAtom, sidebarTabAtom } from "../state/atoms";
import { Toolbar } from "./Toolbar";

// ツールバー。
//
// 見たいのは「絵を並べる代わりに畳んだものが、ちゃんと届くか」。役割の近い操作を
// 1 つの入口へ入れたので、入口を開けば今までと同じところへ行けること。

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("9.9.9") }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // 幅の判定に使う。既定では欄を出せる広さとみなす。
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) =>
      ({
        matches: wide,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
});

let wide = true;
let root: Root | null = null;
let host: HTMLElement | null = null;
let store: ReturnType<typeof createStore>;

function show() {
  store = createStore();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Toolbar />
      </Provider>,
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
  wide = true;
});

const button = (label: string) =>
  document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
const labels = () =>
  rows().map((el) => el.querySelector("span.flex-1")?.textContent ?? "");
const click = (el: HTMLElement) => act(() => el.click());
const row = (label: string) => rows()[labels().indexOf(label)];

describe("右の欄", () => {
  it("3 択を 1 つの入口に畳む", () => {
    show();
    click(button("右の欄"));
    expect(labels()).toEqual(["出さない", "目次", "コメント"]);
  });

  it("いまそれである行に印が付く", () => {
    show();
    click(button("右の欄"));
    // 既定は目次。
    expect(row("目次").classList.contains("is-on")).toBe(true);
    expect(row("コメント").classList.contains("is-on")).toBe(false);
  });

  it("選ぶと切り替わる", () => {
    show();
    click(button("右の欄"));
    click(row("コメント"));
    expect(store.get(railAtom)).toBe("comments");
  });
});

describe("そのほか", () => {
  it("全文検索はここから開く", () => {
    show();
    click(button("そのほか"));
    click(row("全文検索"));
    expect(store.get(sidebarOpenAtom)).toBe(true);
    expect(store.get(sidebarTabAtom)).toBe("search");
  });
});

describe("分割", () => {
  it("右・下・解除を 1 つの入口に畳む", () => {
    show();
    click(button("分割"));
    expect(labels()).toEqual(["右に分割", "下に分割", "分割を解除"]);
  });

  it("分割していないうちは解除を選ばせない", () => {
    show();
    click(button("分割"));
    expect(row("分割を解除").hasAttribute("disabled")).toBe(true);
  });
});

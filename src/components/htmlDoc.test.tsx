// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HtmlDoc } from "./HtmlDoc";

// HTML は iframe で描く。読み込み直すと iframe を作り直し、中のスクリプトの状態も初めに戻る。
// 読み込み直すのは、下の帯の釦と、メニューの ⌘R から送られてくる知らせの 2 つ。

vi.mock("../lib/fsAccess", () => ({
  readText: async () => "<p>本文</p>",
}));
vi.mock("../lib/asset", () => ({
  assetSrc: (abs: string) => `asset://${abs}`,
}));

const heard: Array<() => void> = [];
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: async (_name: string, fn: () => void) => {
      heard.push(fn);
      return () => heard.splice(heard.indexOf(fn), 1);
    },
  }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  heard.length = 0;
});

async function show(active = true) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Provider store={createStore()}>
        <HtmlDoc abs="/本/見本.html" active={active} />
      </Provider>,
    );
  });
  // 知らせを聞く口は後から読み込むので、つながるまで待つ。
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return host;
}

const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

describe("読み込み直す", () => {
  it("釦を押すと iframe が作り直される", async () => {
    const el = await show();
    const before = el.querySelector("iframe");
    await act(async () => button(el, "再読み込み")!.click());
    const after = el.querySelector("iframe");
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it("メニューの ⌘R の知らせで作り直される", async () => {
    const el = await show();
    const before = el.querySelector("iframe");
    expect(heard).toHaveLength(1);
    await act(async () => heard[0]());
    expect(el.querySelector("iframe")).not.toBe(before);
  });

  it("今の欄でなければ ⌘R の知らせを聞かない", async () => {
    await show(false);
    expect(heard).toHaveLength(0);
  });

  it("ソースを見ている間は釦を出さない", async () => {
    const el = await show();
    await act(async () => button(el, "ソースを見る")!.click());
    expect(button(el, "再読み込み")).toBeUndefined();
  });
});

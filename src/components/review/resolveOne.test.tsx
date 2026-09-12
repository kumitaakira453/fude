// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReviewThread } from "../../lib/review";

// 一覧から解決にしたとき、押した一枚で札が下がること。
//
// 台帳への書き込みと読み直しを待ってから消すと、押しても何も起きない間が
// できて、効いていないように見える。ここで見たいのはその順番なので、
// 書き込みは「まだ終わらない約束」に差し替えて確かめる。

let letGo: (ok: boolean) => void = () => {};

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: () => Promise.resolve(true),
  message: () => Promise.resolve(),
}));
vi.mock("../../lib/review", async (real) => {
  const mod = await real<typeof import("../../lib/review")>();
  return {
    ...mod,
    resolveThread: () => new Promise<boolean>((done) => (letGo = done)),
    reopenThread: () => Promise.resolve(true),
    readVersion: () => Promise.resolve(null),
    reviewPrompt: () => "",
  };
});
vi.mock("../../state/review", async (real) => {
  const mod = await real<typeof import("../../state/review")>();
  return { ...mod, syncLedger: () => Promise.resolve() };
});

const { ReviewScreen } = await import("./ReviewScreen");
const { ledgerAtom, reviewThreadAtom } = await import("../../state/review");
const { activeFolderIdAtom, contentCacheAtom } = await import("../../state/atoms");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

const thread = (id: string, body: string): ReviewThread => ({
  id,
  file: "/docs/a.md",
  quote: "本文",
  block_hash: "",
  selection: "本文",
  selection_offset: 0,
  section_path: [],
  base_version: "v1",
  status: { kind: "open" },
  comments: [{ id: `c-${id}`, author: "you", body, created_at: 0 }],
  created_at: 0,
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function show() {
  const store = createStore();
  store.set(ledgerAtom, {
    version: 1,
    threads: [thread("t1", "ひとつめ"), thread("t2", "ふたつめ")],
  } as never);
  store.set(activeFolderIdAtom, "/docs");
  store.set(contentCacheAtom, new Map([["a.md", "本文\n"]]));
  store.set(reviewThreadAtom, "t1");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <ReviewScreen />
      </Provider>,
    ),
  );
  return store;
}

const cards = () => [...document.querySelectorAll(".mg-thread-card")].map((e) => e.textContent);

describe("一覧から解決にする", () => {
  it("書き込みを待たずに、押した札がその場で下がる", () => {
    show();
    expect(cards().join("")).toContain("ひとつめ");
    const done = document.querySelectorAll(".mg-thread-done")[0] as HTMLButtonElement;
    act(() => done.click());
    // まだ台帳は書き終えていない（letGo を呼んでいない）。
    expect(cards().join("")).not.toContain("ひとつめ");
    expect(cards().join("")).toContain("ふたつめ");
  });

  it("しくじったら戻す", async () => {
    show();
    const done = document.querySelectorAll(".mg-thread-done")[0] as HTMLButtonElement;
    act(() => done.click());
    expect(cards().join("")).not.toContain("ひとつめ");
    await act(async () => {
      letGo(false);
      await Promise.resolve();
    });
    expect(cards().join("")).toContain("ひとつめ");
  });
});

// @vitest-environment jsdom
import { atom, createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ActivityStrip } from "./ActivityStrip";

// 縦の帯のコメントの入口。未解決があることは釦の中の点だけで示し、数は
// 吹き出し（と読み上げの名前）で出す。

// 未解決の数は台帳から導くので、試験では数を直に置けるものに替える。
vi.mock("../state/review", async (real) => ({
  ...(await real<typeof import("../state/review")>()),
  openTotalAtom: atom(0),
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
});

async function show(count: number) {
  const { openTotalAtom } = await import("../state/review");
  const store = createStore();
  store.set(openTotalAtom as ReturnType<typeof atom<number>>, count);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <ActivityStrip />
      </Provider>,
    ),
  );
  return host.querySelector<HTMLElement>('[data-key="⌘⇧R"]')!;
}

describe("縦の帯のコメントの入口", () => {
  it("未解決があると点だけを出し、数は吹き出しと読み上げの名前に入れる", async () => {
    const btn = await show(9);
    expect(host!.querySelector(".mg-strip-dot")).not.toBeNull();
    expect(host!.querySelector(".mg-strip-dot")!.textContent).toBe("");
    expect(btn.dataset.tip).toBe("コメント一覧（全ファイル）・未解決 9 件");
    expect(btn.getAttribute("aria-label")).toBe("コメント一覧（全ファイル）・未解決 9 件");
  });

  it("0 件なら点を出さない", async () => {
    const btn = await show(0);
    expect(host!.querySelector(".mg-strip-dot")).toBeNull();
    expect(btn.dataset.tip).toBe("コメント一覧（全ファイル）");
  });
});

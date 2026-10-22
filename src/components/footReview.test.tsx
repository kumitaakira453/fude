// @vitest-environment jsdom
import { atom, createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { StatusBar } from "./StatusBar";

// 足元の帯のコメント一覧の入口。未解決があれば点と数を添え、吹き出しにも数を出す。

// 未解決の数は台帳から導くので、試験では数を直に置けるものに替える。
vi.mock("../state/review", async (real) => ({
  ...(await real<typeof import("../state/review")>()),
  openTotalAtom: atom(0),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // 足元の帯は窓の幅で右の欄を出せるかを見る。
  window.matchMedia = (query: string): MediaQueryList => {
    const mql: Partial<MediaQueryList> = {
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    return mql as MediaQueryList;
  };
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
        <StatusBar />
      </Provider>,
    ),
  );
  return host.querySelector<HTMLElement>('[data-key="⌘⇧R"]')!;
}

describe("足元の帯のコメント一覧の入口", () => {
  it("未解決があると点と数を出し、吹き出しにも数を入れる", async () => {
    const btn = await show(9);
    expect(btn.querySelector(".mg-foot-dot.is-warn")).not.toBeNull();
    expect(btn.textContent).toBe("コメント一覧9");
    expect(btn.dataset.tip).toBe("コメント一覧（全ファイル）・未解決 9 件");
  });

  it("0 件なら点も数も出さない", async () => {
    const btn = await show(0);
    expect(btn.querySelector(".mg-foot-dot")).toBeNull();
    expect(btn.textContent).toBe("コメント一覧");
    expect(btn.dataset.tip).toBe("コメント一覧（全ファイル）");
  });
});

// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as A from "../state/atoms";
import { toastAtom } from "../state/toast";
import { useUrlSync } from "./useUrlSync";

// 別のウィンドウで開いたとき、URL に載ったフォルダとファイルを開く。

const opened: { path: string; file?: string; only?: boolean }[] = [];
let exists = true;

vi.mock("./useWorkspace", () => ({
  useWorkspace: () => ({
    refreshFolders: async () => {},
    openFolder: async (path: string, opts: { file?: string; only?: boolean } = {}) =>
      void opened.push({ path, ...opts }),
    openWorkspace: async () => {},
    openDoc: async () => {},
    openFile: () => {},
    holdDraft: () => false,
  }),
  whenOpened: () => Promise.resolve(),
}));
vi.mock("../lib/fsAccess", async (real) => ({
  ...(await real<typeof import("../lib/fsAccess")>()),
  pathExists: async () => exists,
}));
vi.mock("../lib/boot", () => ({
  dropBootCurtain: () => {},
  whenDocShown: () => Promise.resolve(),
}));
vi.mock("../lib/windows", async (real) => ({
  ...(await real<typeof import("../lib/windows")>()),
  currentWindowLabel: () => "doc-1",
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  opened.length = 0;
  exists = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  history.replaceState(null, "", "#");
});

async function boot(hash: string) {
  history.replaceState(null, "", hash);
  const store = createStore();
  function Sync() {
    useUrlSync();
    return null;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Provider store={store}>
        <Sync />
      </Provider>,
    );
    await new Promise((ok) => setTimeout(ok, 20));
  });
  return store;
}

describe("URL に載ったフォルダを開く", () => {
  it("開いたことの無いフォルダでも、実在すれば絶対パスのまま開く", async () => {
    await boot("#folder=%2Fw%2F%E4%B9%99&file=%2Fw%2F%E4%B9%99%2Fa.md&only=1");
    expect(opened).toEqual([{ path: "/w/乙", file: "/w/乙/a.md", only: true }]);
  });

  it("無いフォルダなら、知らせてからスタート画面へ戻す", async () => {
    exists = false;
    const store = await boot("#folder=%2Fw%2Fgone&file=%2Fw%2Fgone%2Fa.md&only=1");
    expect(opened).toEqual([]);
    expect(store.get(A.activeFolderIdAtom)).toBeNull();
    expect(store.get(toastAtom)?.text).toBe("フォルダが見つかりません");
  });
});

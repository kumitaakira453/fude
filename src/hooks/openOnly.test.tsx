// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as A from "../state/atoms";
import { useWorkspace } from "./useWorkspace";

// 「そのファイルだけの窓」（別の窓で開く）。窓の名前は空いている doc-1・doc-2 …
// を使い回すので、前に同じ名前で開いていた窓のタブの控えが残っている。
// それで頼まれたファイルを上書きしない。

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => (cmd === "scan_tree" || cmd === "folder_mtimes" ? [] : null),
}));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: () => Promise.resolve("/data") }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: () => Promise.resolve() }));
vi.mock("../lib/windows", async (real) => ({
  ...(await real<typeof import("../lib/windows")>()),
  recordRecentFolder: async () => {},
}));
vi.mock("../lib/idb", async (real) => ({
  ...(await real<typeof import("../lib/idb")>()),
  registerFolder: async () => [],
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

function rig() {
  const store = createStore();
  // 前に同じ名前の窓で開いていたタブ。
  store.set(A.savedLayoutsAtom, {
    "/本": { layout: { kind: "leaf", id: "p1", tabs: ["前に開いていた.md"], active: 0 }, active: "p1" },
  });
  let ws: ReturnType<typeof useWorkspace> | null = null;
  function Probe() {
    ws = useWorkspace();
    return null;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Probe />
      </Provider>,
    ),
  );
  return { store, ws: () => ws! };
}

const tabs = (store: ReturnType<typeof createStore>) => {
  const layout = store.get(A.layoutAtom);
  return layout.kind === "leaf" ? layout.tabs : [];
};

describe("そのファイルだけの窓", () => {
  it("控えのタブが残っていても、頼まれたファイルを開く", async () => {
    const r = rig();
    await act(async () => {
      await r.ws().openFolder("/本", { file: "頼んだ.md", only: true });
      await new Promise((ok) => setTimeout(ok, 30));
    });
    expect(tabs(r.store)).toEqual(["頼んだ.md"]);
  });

  it("ふつうに開くときは、控えのタブへ戻す", async () => {
    const r = rig();
    await act(async () => {
      await r.ws().openFolder("/本");
      await new Promise((ok) => setTimeout(ok, 30));
    });
    expect(tabs(r.store)).not.toContain("頼んだ.md");
  });
});

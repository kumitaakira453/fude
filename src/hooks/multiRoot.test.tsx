// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as A from "../state/atoms";
import { useWorkspace } from "./useWorkspace";

// 根を 2 つ並べた窓。同じ相対パスのファイルが両方の根に居ても、
// 別のファイルとして木・タブ・本文の控えに載る。

const SCANS: Record<string, { path: string; dir: boolean }[]> = {
  "/w/a": [
    { path: "README.md", dir: false },
    { path: "docs", dir: true },
    { path: "docs/x.md", dir: false },
  ],
  "/w/b": [{ path: "README.md", dir: false }],
};
const TEXT: Record<string, string> = {
  "/w/a/README.md": "a の本文",
  "/w/b/README.md": "b の本文",
  "/w/a/docs/x.md": "x",
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { root?: string }) => {
    if (cmd === "scan_tree") return SCANS[args.root ?? ""] ?? [];
    if (cmd === "folder_mtimes") return [];
    return null;
  },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: async (path: string) => TEXT[path] ?? "",
  stat: async () => ({ mtime: null }),
  exists: async () => true,
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

async function rig() {
  const store = createStore();
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
  await act(async () => {
    await ws!.openFolder("/w/a");
    store.set(A.extraRootsAtom, ["/w/b"]);
    await ws!.refreshTreeStructure();
  });
  return { store, ws: () => ws! };
}

const tabs = (store: ReturnType<typeof createStore>) => {
  const layout = store.get(A.layoutAtom);
  return layout.kind === "leaf" ? layout.tabs : [];
};

describe("根を 2 つ並べた窓", () => {
  it("木は根を行として並べ、その下に中身を吊るす", async () => {
    const { store } = await rig();
    const tree = store.get(A.treeAtom);
    expect(tree.map((n) => [n.path, n.name])).toEqual([
      ["/w/a", "a"],
      ["/w/b", "b"],
    ]);
    expect(store.get(A.filesAtom).map((f) => f.path).sort()).toEqual([
      "/w/a/README.md",
      "/w/a/docs/x.md",
      "/w/b/README.md",
    ]);
  });

  it("同じ相対パスのファイルを、別々のタブと控えで開ける", async () => {
    const { store, ws } = await rig();
    await act(async () => {
      ws().openFile("/w/a/README.md");
      ws().openFile("/w/b/README.md");
      await new Promise((ok) => setTimeout(ok, 10));
    });
    expect(tabs(store)).toEqual(["/w/a/README.md", "/w/b/README.md"]);
    const cache = store.get(A.contentCacheAtom);
    expect(cache.get("/w/a/README.md")).toBe("a の本文");
    expect(cache.get("/w/b/README.md")).toBe("b の本文");
  });

  it("頭が / のリンクは、書いたファイルの根から解く", async () => {
    const { store, ws } = await rig();
    act(() => ws().navigate("/w/b/README.md", "/README.md"));
    expect(tabs(store)).toEqual(["/w/b/README.md"]);
    act(() => ws().navigate("/w/a/README.md", "docs/x"));
    expect(tabs(store)).toContain("/w/a/docs/x.md");
  });
});

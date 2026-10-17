// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { useWorkspace } from "./useWorkspace";

// セッションの書いたファイルを fude の中で動かしたとき。セッションの記録は
// 書いたときの道筋のままなので、動かしたことをワークスペースに覚えておく。

const saves: Workspace[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "save_workspace") saves.push(args.workspace as Workspace);
    return cmd === "scan_tree" || cmd === "folder_mtimes" ? [] : null;
  },
}));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: () => Promise.resolve("/data") }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: () => Promise.resolve() }));
vi.mock("../lib/fsAccess", async (real) => ({
  ...(await real<typeof import("../lib/fsAccess")>()),
  renamePath: async () => {},
  pathExists: async () => false,
}));
vi.mock("../lib/review", async (real) => ({
  ...(await real<typeof import("../lib/review")>()),
  moveReviewFile: async () => {},
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
  saves.length = 0;
});

const ws: Workspace = {
  id: "ws-c",
  name: "調査",
  color: "teal",
  roots: ["/w"],
  lastOpened: 1,
  claude: {
    sessionId: "s1",
    nameFollows: true,
    wrote: [
      { path: "/w/docs/a.md", at: 2 },
      { path: "/w/b.md", at: 1 },
    ],
  },
};

function rig() {
  const store = createStore();
  store.set(A.workspaceAtom, ws);
  store.set(A.workspacesAtom, [ws]);
  let hook: ReturnType<typeof useWorkspace> | null = null;
  function Probe() {
    hook = useWorkspace();
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
  return { store, ws: () => hook! };
}

describe("fude の中で動かしたとき", () => {
  it("フォルダの名前を変えると、中のファイルの道筋を付け替え、動かしたことを覚えて控える", async () => {
    const r = rig();
    await act(async () => {
      await r.ws().renameEntry("/w/docs", "notes", true);
    });
    const claude = r.store.get(A.workspaceAtom)?.claude;
    expect(claude?.moved).toEqual([["/w/docs", "/w/notes"]]);
    expect(claude?.wrote).toEqual([
      { path: "/w/notes/a.md", at: 2 },
      { path: "/w/b.md", at: 1 },
    ]);
    expect(saves.at(-1)?.claude?.moved).toEqual([["/w/docs", "/w/notes"]]);
  });
});

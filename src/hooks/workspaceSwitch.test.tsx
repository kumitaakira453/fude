// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { clearStash } from "../state/rootStash";
import { flushWorkspaceSave } from "../state/workspace";
import { useKeepWorkspace } from "./useKeepWorkspace";
import { useWorkspace } from "./useWorkspace";

// ワークスペースの切り替え。根が同じものどうしは走査し直さず、タブの並びだけを
// 差し替える。並びは開いたワークスペースの控えに書く。

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let saved: Workspace[] = [];
// 根ごとに並んでいるファイル（無ければ a.md と b.md）と、ファイルの更新時刻（無ければ 1）。
const disk = new Map<string, string[]>();
const mtimes = new Map<string, number>();
const reads: string[] = [];
// 置いてあるあいだ、走査が返らない。
let hold: Promise<void> | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "scan_tree") {
      if (hold) await hold;
      return (disk.get(args.root as string) ?? ["a.md", "b.md"]).map((path) => ({
        path,
        dir: false,
      }));
    }
    if (cmd === "folder_mtimes") {
      return (disk.get(args.root as string) ?? ["a.md", "b.md"]).map((path) => ({
        path,
        mtime: mtimes.get(`${args.root as string}/${path}`) ?? 1,
      }));
    }
    if (cmd === "list_workspaces") return saved;
    if (cmd === "focus_workspace") return false;
    return null;
  },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: async (path: string) => {
    reads.push(path);
    return `本文 ${mtimes.get(path) ?? 1}`;
  },
  stat: async (path: string) => ({ mtime: new Date(mtimes.get(path) ?? 1) }),
  exists: async () => true,
}));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: () => Promise.resolve("/data") }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: () => Promise.resolve() }));
vi.mock("../lib/windows", async (real) => ({
  ...(await real<typeof import("../lib/windows")>()),
  recordRecentFolder: async () => {},
  setWindowTitle: async () => {},
}));
vi.mock("../lib/idb", async (real) => ({
  ...(await real<typeof import("../lib/idb")>()),
  registerFolder: async () => [],
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  calls.length = 0;
  saved = [];
  disk.clear();
  mtimes.clear();
  reads.length = 0;
  hold = null;
  clearStash();
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const leaf = (tabs: string[]) => ({ kind: "leaf" as const, id: "p1", tabs, active: 0 });

function rig(store = createStore()) {
  let ws: ReturnType<typeof useWorkspace> | null = null;
  function Probe() {
    ws = useWorkspace();
    useKeepWorkspace();
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
// 索引は手が空いてから走る（jsdom では少し待ってから）。
const settle = () => new Promise((ok) => setTimeout(ok, 20));
const idle = () => new Promise((ok) => setTimeout(ok, 600));

describe("フォルダを開く", () => {
  it("そのフォルダのワークスペースを作り、フォルダごとに控えていたタブを引き継ぐ", async () => {
    const store = createStore();
    store.set(A.savedLayoutsAtom, {
      "/本": { layout: leaf(["a.md"]), active: "p1" },
    });
    const r = rig(store);
    await act(async () => {
      await r.ws().openFolder("/本");
      await settle();
    });
    const ws = store.get(A.workspaceAtom);
    expect(ws).toMatchObject({ roots: ["/本"], folder: "/本", name: "本" });
    expect(tabs(store)).toEqual(["/本/a.md"]);
    expect(calls.some((c) => c.cmd === "bind_window" && c.args.workspace === ws?.id)).toBe(true);
  });

  it("2 度目は同じワークスペースを開く（作り直さない）", async () => {
    const r = rig();
    await act(async () => {
      await r.ws().openFolder("/本");
      await settle();
    });
    const first = r.store.get(A.workspaceAtom)!.id;
    act(() => r.store.set(A.activeFolderIdAtom, null));
    await act(async () => {
      await r.ws().openFolder("/本");
      await settle();
    });
    expect(r.store.get(A.workspaceAtom)!.id).toBe(first);
    expect(r.store.get(A.workspacesAtom).filter((w) => w.folder === "/本")).toHaveLength(1);
  });
});

describe("ワークスペースを切り替える", () => {
  const one: Workspace = {
    id: "ws-one",
    name: "要件定義",
    color: "teal",
    roots: ["/本"],
    lastOpened: 2,
    layout: leaf(["/本/a.md"]),
    active: "p1",
  };
  const two: Workspace = {
    id: "ws-two",
    name: "Slack 対応",
    color: "rose",
    roots: ["/本"],
    lastOpened: 1,
    layout: leaf(["/本/b.md"]),
    active: "p1",
  };

  it("根が同じなら走査し直さず、タブの並びだけを差し替える", async () => {
    const r = rig();
    await act(async () => {
      await r.ws().openWorkspace(one);
      await settle();
    });
    expect(tabs(r.store)).toEqual(["/本/a.md"]);
    const scans = calls.filter((c) => c.cmd === "scan_tree").length;
    await act(async () => {
      await r.ws().openWorkspace(two);
      await settle();
    });
    expect(tabs(r.store)).toEqual(["/本/b.md"]);
    expect(calls.filter((c) => c.cmd === "scan_tree").length).toBe(scans);
    expect(r.store.get(A.workspaceAtom)?.id).toBe("ws-two");
  });

  it("タブを動かすと、開いているワークスペースの控えに書く（前のものには書かない）", async () => {
    const r = rig();
    await act(async () => {
      await r.ws().openWorkspace(one);
      await settle();
      await r.ws().openWorkspace(two);
      await settle();
    });
    calls.length = 0;
    await act(async () => {
      r.ws().openFile("/本/a.md");
      await settle();
    });
    flushWorkspaceSave();
    const writes = calls.filter((c) => c.cmd === "save_workspace");
    expect(writes.at(-1)?.args.workspace).toMatchObject({
      id: "ws-two",
      layout: { tabs: ["/本/b.md", "/本/a.md"] },
    });
    expect(writes.some((c) => (c.args.workspace as Workspace).id === "ws-one")).toBe(false);
  });

  it("別の窓で開いていれば、その窓を前に出すだけで切り替えない", async () => {
    const r = rig();
    await act(async () => {
      await r.ws().openWorkspace(one);
      await settle();
    });
    const real = calls.push.bind(calls);
    const core = await import("@tauri-apps/api/core");
    const spy = vi.spyOn(core, "invoke").mockImplementation(async (cmd, args) => {
      real({ cmd, args: (args ?? {}) as Record<string, unknown> });
      return cmd === "focus_workspace";
    });
    await act(async () => {
      await r.ws().openWorkspace(two);
      await settle();
    });
    spy.mockRestore();
    expect(r.store.get(A.workspaceAtom)?.id).toBe("ws-one");
  });
});

describe("戻ってきたときは読み直さない", () => {
  const ws = (id: string, roots: string[], tab: string): Workspace => ({
    id,
    name: id,
    color: "teal",
    roots,
    lastOpened: 1,
    layout: leaf([tab]),
    active: "p1",
  });
  const a = ws("ws-a", ["/甲"], "/甲/a.md");
  const b = ws("ws-b", ["/乙"], "/乙/a.md");

  async function visitAndLeave() {
    const r = rig();
    await act(async () => {
      await r.ws().openWorkspace(a);
      await idle();
      await r.ws().openWorkspace(b);
      await idle();
    });
    return r;
  }

  it("走査が返らなくても、戻った瞬間に木とタブと本文が出ている", async () => {
    const r = await visitAndLeave();
    let release = () => {};
    hold = new Promise((ok) => (release = ok));
    await act(async () => {
      await r.ws().openWorkspace(a);
    });
    expect(r.store.get(A.filesAtom).map((f) => f.path)).toEqual(["/甲/a.md", "/甲/b.md"]);
    expect(tabs(r.store)).toEqual(["/甲/a.md"]);
    expect(r.store.get(A.contentCacheAtom).get("/甲/a.md")).toBe("本文 1");
    // 前の根の本文は混ざらない。
    expect(r.store.get(A.contentCacheAtom).has("/乙/a.md")).toBe(false);
    await act(async () => {
      release();
      await idle();
    });
  });

  it("戻った後に読み直すのは、離れているあいだに変わったファイルだけ", async () => {
    const r = await visitAndLeave();
    mtimes.set("/甲/b.md", 2);
    reads.length = 0;
    await act(async () => {
      await r.ws().openWorkspace(a);
      await idle();
    });
    expect(reads).toEqual(["/甲/b.md"]);
    expect(r.store.get(A.contentCacheAtom).get("/甲/b.md")).toBe("本文 2");
  });

  it("離れているあいだに消えたファイルは、本文を落としてタブも閉じる", async () => {
    const r = await visitAndLeave();
    disk.set("/甲", ["b.md"]);
    await act(async () => {
      await r.ws().openWorkspace(a);
      await idle();
    });
    expect(r.store.get(A.filesAtom).map((f) => f.path)).toEqual(["/甲/b.md"]);
    expect(r.store.get(A.contentCacheAtom).has("/甲/a.md")).toBe(false);
    expect(tabs(r.store)).toEqual([]);
  });

  it("根が一部重なるワークスペースへ移っても、重なる根は読み直さない", async () => {
    const r = rig();
    const both = ws("ws-both", ["/甲", "/乙"], "/甲/a.md");
    await act(async () => {
      await r.ws().openWorkspace(both);
      await idle();
    });
    reads.length = 0;
    await act(async () => {
      await r.ws().openWorkspace(a);
      await idle();
    });
    expect(reads).toEqual([]);
    expect(r.store.get(A.contentCacheAtom).has("/甲/a.md")).toBe(true);
    expect(r.store.get(A.contentCacheAtom).has("/乙/a.md")).toBe(false);
  });

  it("表示するファイルの設定を変えた後は、控えを使わず走査して並べ直す", async () => {
    const r = await visitAndLeave();
    act(() => r.store.set(A.showOtherFilesAtom, !r.store.get(A.showOtherFilesAtom)));
    let release = () => {};
    hold = new Promise((ok) => (release = ok));
    await act(async () => {
      await r.ws().openWorkspace(a);
    });
    expect(r.store.get(A.filesAtom)).toEqual([]);
    await act(async () => {
      release();
      await idle();
    });
    expect(r.store.get(A.filesAtom).map((f) => f.path)).toEqual(["/甲/a.md", "/甲/b.md"]);
  });
});

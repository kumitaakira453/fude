// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeSession, Wrote } from "../lib/claude";
import type { Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { phaseForAtom } from "../state/claude";
import { useClaude } from "./useClaude";

// Claude のセッションを追う（ベータ）。名前の変更、書き足し、消されたときの判定。

let sessions: ClaudeSession[] = [];
let wrote: Wrote[] = [];
let alive = new Set<string>();
const saves: Workspace[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "claude_sessions") return sessions;
    if (cmd === "claude_session_files") return { wrote, gone: false };
    if (cmd === "save_workspace") saves.push(args.workspace as Workspace);
    return null;
  },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (path: string) => alive.has(path),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  sessions = [];
  wrote = [];
  alive = new Set();
  saves.length = 0;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const linked = (over: Partial<Workspace["claude"]> = {}): Workspace => ({
  id: "ws-c",
  name: "[V]fude",
  color: "teal",
  roots: ["/w"],
  lastOpened: 1,
  layout: { kind: "leaf", id: "p1", tabs: ["/w/a.md"], active: 0 },
  claude: {
    sessionId: "s1",
    nameFollows: true,
    lastName: "[V]fude",
    transcript: "/t/s1.jsonl",
    wrote: [{ path: "/w/a.md", at: 1 }],
    ...over,
  },
});

async function rig(ws: Workspace) {
  const store = createStore();
  store.set(A.claudeLinkAtom, true);
  store.set(A.workspaceAtom, ws);
  store.set(A.workspacesAtom, [ws]);
  store.set(A.layoutAtom, { kind: "leaf", id: "p1", tabs: ["/w/a.md"], active: 0 });
  store.set(A.activePaneIdAtom, "p1");
  function Probe() {
    useClaude();
    return null;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Provider store={store}>
        <Probe />
      </Provider>,
    );
    await new Promise((ok) => setTimeout(ok, 30));
  });
  return store;
}

const tabs = (store: ReturnType<typeof createStore>) => {
  const layout = store.get(A.layoutAtom);
  return layout.kind === "leaf" ? layout.tabs : [];
};

describe("セッションの名前を追う", () => {
  it("名前が変わったら、ワークスペースの名前も替える", async () => {
    sessions = [{ sessionId: "s1", name: "[V]fude ワークスペース", kind: "background", state: "working" }];
    const store = await rig(linked());
    expect(store.get(A.workspaceAtom)?.name).toBe("[V]fude ワークスペース");
    expect(saves.at(-1)?.name).toBe("[V]fude ワークスペース");
    expect(store.get(phaseForAtom)(store.get(A.workspaceAtom))).toBe("working");
  });

  it("自分で付け直した名前は替えない（セッションの名前だけ覚え直す）", async () => {
    sessions = [{ sessionId: "s1", name: "新しい名前", kind: "background" }];
    const store = await rig({ ...linked({ nameFollows: false }), name: "自分の名前" });
    expect(store.get(A.workspaceAtom)?.name).toBe("自分の名前");
    expect(store.get(A.workspaceAtom)?.claude?.lastName).toBe("新しい名前");
  });
});

describe("書き足したファイル", () => {
  it("新しく書いたものをタブの末尾に足し、見ているタブは替えない", async () => {
    sessions = [{ sessionId: "s1", name: "[V]fude", kind: "background", state: "working" }];
    wrote = [
      { path: "/w/b.md", at: 5 },
      { path: "/w/a.md", at: 1 },
    ];
    const store = await rig(linked());
    expect(tabs(store)).toEqual(["/w/a.md", "/w/b.md"]);
    expect(store.get(A.layoutAtom)).toMatchObject({ active: 0 });
    expect(store.get(A.freshTabsAtom).has("/w/b.md")).toBe(true);
    expect(store.get(A.workspaceAtom)?.claude?.wrote).toEqual(wrote);
  });
});

describe("セッションが一覧から外れたとき", () => {
  it("記録が残っていれば終わった", async () => {
    alive.add("/t/s1.jsonl");
    const store = await rig(linked());
    expect(store.get(phaseForAtom)(store.get(A.workspaceAtom))).toBe("ended");
  });

  it("記録も無ければ削除された（ワークスペースとタブは残す）", async () => {
    const store = await rig(linked());
    expect(store.get(phaseForAtom)(store.get(A.workspaceAtom))).toBe("deleted");
    expect(store.get(A.workspaceAtom)?.id).toBe("ws-c");
    expect(tabs(store)).toEqual(["/w/a.md"]);
  });
});

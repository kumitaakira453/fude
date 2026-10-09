// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { barAtom } from "../state/workspaceBar";
import { useWorkspaceOps } from "./useWorkspaceOps";

// 札の × と右押しの「削除」。確かめてから消し、開いているものは隣の札へ
// 移ってから消す。

let answer = true;
let asked = 0;
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: async () => {
    asked++;
    return answer;
  },
}));

// 別の窓で開いているワークスペース。
let elsewhere = new Set<string>();
// 控えのファイルを消したもの。
const dropped: string[] = [];
vi.mock("../lib/workspaces", async (real) => ({
  ...(await real<typeof import("../lib/workspaces")>()),
  focusWorkspace: async (id: string) => elsewhere.has(id),
  deleteWorkspace: async (id: string) => void dropped.push(id),
  bindWindow: async () => {},
  saveWorkspace: async () => {},
}));

// 移った先。開くとその窓のワークスペースになる。別の窓で開いているものは、
// その窓が前に出るだけで、この窓は変わらない。
const opened: string[] = [];
let store: ReturnType<typeof createStore>;
vi.mock("./useWorkspace", () => ({
  useWorkspace: () => ({
    openWorkspace: async (ws: Workspace) => {
      opened.push(ws.id);
      if (!elsewhere.has(ws.id)) store.set(A.workspaceAtom, ws);
    },
    refreshTree: async () => {},
  }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const ws = (id: string): Workspace => ({
  id,
  name: id,
  color: "teal",
  roots: [`/w/${id}`],
  lastOpened: 1,
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let ops: ReturnType<typeof useWorkspaceOps>;

function Grab() {
  ops = useWorkspaceOps();
  return null;
}

beforeEach(() => {
  answer = true;
  asked = 0;
  elsewhere = new Set();
  dropped.length = 0;
  opened.length = 0;
  store = createStore();
  store.set(A.workspacesAtom, [ws("a"), ws("b"), ws("c")]);
  store.set(barAtom, ["a", "b", "c"]);
  store.set(A.workspaceAtom, ws("b"));
  store.set(A.activeFolderIdAtom, "/w/b");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Grab />
      </Provider>,
    ),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  localStorage.clear();
});

const close = (id: string) => act(() => ops.closeWorkspace(id));
const ids = () => store.get(A.workspacesAtom).map((w) => w.id);

describe("ワークスペースの削除", () => {
  it("確かめて、はいなら一覧・札の並び・控えから消す", async () => {
    await close("a");
    expect(asked).toBe(1);
    expect(ids()).toEqual(["b", "c"]);
    expect(store.get(barAtom)).toEqual(["b", "c"]);
    expect(dropped).toEqual(["a"]);
  });

  it("いいえなら何も消さない", async () => {
    answer = false;
    await close("a");
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(dropped).toEqual([]);
  });

  it("別の窓で開いているものは、確かめずに断る", async () => {
    elsewhere = new Set(["a"]);
    await close("a");
    expect(asked).toBe(0);
    expect(dropped).toEqual([]);
  });

  it("開いているものは、右隣の札へ移ってから消す", async () => {
    await close("b");
    expect(opened).toEqual(["c"]);
    expect(store.get(A.workspaceAtom)?.id).toBe("c");
    expect(dropped).toEqual(["b"]);
  });

  it("右隣が無ければ左隣へ移る", async () => {
    store.set(A.workspaceAtom, ws("c"));
    await close("c");
    expect(opened).toEqual(["b"]);
    expect(dropped).toEqual(["c"]);
  });

  it("他に札が無ければ、スタート画面へ戻してから消す", async () => {
    store.set(A.workspacesAtom, [ws("b")]);
    store.set(barAtom, ["b"]);
    await close("b");
    expect(opened).toEqual([]);
    expect(store.get(A.workspaceAtom)).toBeNull();
    expect(store.get(A.activeFolderIdAtom)).toBeNull();
    expect(dropped).toEqual(["b"]);
  });

  it("移る先が別の窓で開いていて移れなくても、スタート画面へ戻して消す", async () => {
    elsewhere = new Set(["c"]);
    await close("b");
    expect(store.get(A.workspaceAtom)).toBeNull();
    expect(dropped).toEqual(["b"]);
  });
});

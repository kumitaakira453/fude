// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { barAtom, visitedAtom } from "../state/workspaceBar";
import { useHotkeys } from "./useHotkeys";
import { cycleOrder, WorkspaceCycler } from "../components/WorkspaceCycler";

// ⌃Tab で一覧を送り ⌃ を離して移る（すぐ離せば直前のワークスペースへ）。
// ⌃1〜9 で列の位置へ。⌘ の組は奪わない。

const opened: string[] = [];
vi.mock("./useWorkspace", () => ({
  useWorkspace: () => ({
    newDraft: async () => {},
    openWorkspace: async (ws: Workspace) => void opened.push(ws.id),
  }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  opened.length = 0;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const ws = (id: string): Workspace => ({ id, name: id, color: "teal", roots: ["/w"], lastOpened: 0 });

function rig() {
  const store = createStore();
  store.set(A.workspacesAtom, [ws("a"), ws("b"), ws("c")]);
  store.set(A.workspaceAtom, ws("a"));
  store.set(barAtom, ["a", "b", "c"]);
  store.set(visitedAtom, ["a", "c"]);
  function Keys() {
    useHotkeys();
    return <WorkspaceCycler />;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Keys />
      </Provider>,
    ),
  );
  return store;
}

const up = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, ...init }));
  });
const key = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });

describe("ワークスペースを切り替えるキー", () => {
  it("⌃Tab をすぐ離すと、直前に開いていたものへ（一覧は出さない）", () => {
    rig();
    key({ key: "Tab", ctrlKey: true });
    up({ key: "Control" });
    expect(opened).toEqual(["c"]);
    expect(document.querySelector(".mg-ws-cycler")).toBeNull();
  });

  it("⌃ を押したまま Tab を 2 回押して離すと、3 番目へ", () => {
    rig();
    key({ key: "Tab", ctrlKey: true });
    key({ key: "Tab", ctrlKey: true });
    expect(opened).toEqual([]);
    up({ key: "Control" });
    expect(opened).toEqual(["b"]);
  });

  it("押したままにすると一覧が出て、Esc で何もせず閉じる", async () => {
    rig();
    key({ key: "Tab", ctrlKey: true });
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 200));
    });
    const names = Array.from(document.querySelectorAll(".mg-ws-cycler [role=option]")).map(
      (el) => el.textContent,
    );
    expect(names.map((n) => n?.slice(0, 1))).toEqual(["a", "c", "b"]);
    key({ key: "Escape" });
    up({ key: "Control" });
    expect(opened).toEqual([]);
    expect(document.querySelector(".mg-ws-cycler")).toBeNull();
  });

  it("⌘2 で列の 2 番目、⌘9 で最後", () => {
    rig();
    key({ key: "2", code: "Digit2", metaKey: true });
    key({ key: "9", code: "Digit9", metaKey: true });
    expect(opened).toEqual(["b", "c"]);
  });

  it("今いるものを指したら何もしない", () => {
    rig();
    key({ key: "1", code: "Digit1", metaKey: true });
    expect(opened).toEqual([]);
  });

  it("⌃ の数字では移らない", () => {
    rig();
    key({ key: "2", code: "Digit2", ctrlKey: true });
    expect(opened).toEqual([]);
  });
});

describe("⌘J の一覧は、選ぶまで開いたまま", () => {
  const shown = () => document.querySelector(".mg-ws-cycler");

  it("⌘ を離しても移らず、一覧はそのまま", () => {
    rig();
    key({ key: "j", code: "KeyJ", metaKey: true });
    up({ key: "Meta" });
    expect(opened).toEqual([]);
    expect(shown()).not.toBeNull();
  });

  it("J で選択を進め、Enter で移る", () => {
    rig();
    key({ key: "j", code: "KeyJ", metaKey: true });
    up({ key: "Meta" });
    key({ key: "j", code: "KeyJ" });
    key({ key: "Enter" });
    expect(opened).toEqual(["b"]);
    expect(shown()).toBeNull();
  });

  it("Esc で何もせず閉じる", () => {
    rig();
    key({ key: "j", code: "KeyJ", metaKey: true });
    key({ key: "Escape" });
    expect(opened).toEqual([]);
    expect(shown()).toBeNull();
  });

  it("もう一度 ⌘J で閉じる", () => {
    rig();
    key({ key: "j", code: "KeyJ", metaKey: true });
    key({ key: "j", code: "KeyJ", metaKey: true });
    expect(opened).toEqual([]);
    expect(shown()).toBeNull();
  });
});

describe("⌘T で作るメニュー", () => {
  it("開き、もう一度押すと閉じる", () => {
    const store = rig();
    key({ key: "t", code: "KeyT", metaKey: true });
    expect(store.get(A.newWorkspaceAtom)).not.toBeNull();
    key({ key: "t", code: "KeyT", metaKey: true });
    expect(store.get(A.newWorkspaceAtom)).toBeNull();
  });

  it("⌘⇧T は閉じたタブを開き直す（作るメニューは開かない）", () => {
    const store = rig();
    store.set(A.closedTabsAtom, [{ path: "/w/a.md", paneId: "p1", index: 0 }]);
    key({ key: "T", code: "KeyT", metaKey: true, shiftKey: true });
    expect(store.get(A.newWorkspaceAtom)).toBeNull();
    expect(store.get(A.closedTabsAtom)).toEqual([]);
  });
});

describe("一覧の並び", () => {
  it("今いるものが先頭、続いて最近開いた順、残りは札の並び順", () => {
    expect(cycleOrder(["a", "b", "c", "d"], ["b", "d", "a"], "b")).toEqual(["b", "d", "a", "c"]);
  });

  it("札から外したものは並べない", () => {
    expect(cycleOrder(["a", "b"], ["x", "a"], "a")).toEqual(["a", "b"]);
  });
});

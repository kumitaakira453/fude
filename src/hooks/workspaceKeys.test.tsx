// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { barAtom, visitedAtom } from "../state/workspaceBar";
import { useHotkeys } from "./useHotkeys";

// ⌃Tab で直前のワークスペースへ、⌃1〜9 で列の位置へ。⌘ の組は奪わない。

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
    return null;
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

const key = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });

describe("ワークスペースを切り替えるキー", () => {
  it("⌃Tab で直前に開いていたものへ", () => {
    rig();
    key({ key: "Tab", ctrlKey: true });
    expect(opened).toEqual(["c"]);
  });

  it("⌃2 で列の 2 番目、⌃9 で最後", () => {
    rig();
    key({ key: "2", code: "Digit2", ctrlKey: true });
    key({ key: "9", code: "Digit9", ctrlKey: true });
    expect(opened).toEqual(["b", "c"]);
  });

  it("今いるものを指したら何もしない", () => {
    rig();
    key({ key: "1", code: "Digit1", ctrlKey: true });
    expect(opened).toEqual([]);
  });

  it("⌘ の数字は奪わない", () => {
    rig();
    key({ key: "2", code: "Digit2", metaKey: true });
    expect(opened).toEqual([]);
  });
});

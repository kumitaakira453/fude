// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activePaneIdAtom,
  layoutAtom,
  revealInTreeAtom,
  sidebarOpenAtom,
  sidebarTabAtom,
  type LeafNode,
} from "../state/atoms";
import { TabBar } from "./TabBar";

// タブを押したときの木。切り替えた 1 回目で木の行まで送る（左の欄は開かない）。
// 今のタブをもう一度押すと、左の欄を開いてファイルの面で出す。

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({ openInNewWindow: async () => false, rootFor: () => "/w" }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  localStorage.clear();
});

const PANE: LeafNode = { kind: "leaf", id: "p1", tabs: ["/w/a.md", "/w/b.md"], active: 0 };

function show(setup?: (s: ReturnType<typeof createStore>) => void) {
  const store = createStore();
  store.set(layoutAtom, PANE);
  store.set(activePaneIdAtom, "p1");
  setup?.(store);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <TabBar pane={PANE} isActive />
      </Provider>,
    ),
  );
  const tab = (name: string) =>
    Array.from(host!.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent === name)!;
  return { store, tab };
}

describe("タブを押したときの木", () => {
  it("切り替えた 1 回目で木の行まで送り、左の欄は開かず面も替えない", () => {
    const { store, tab } = show((s) => {
      s.set(sidebarOpenAtom, false);
      s.set(sidebarTabAtom, "search");
    });
    act(() => tab("b.md").click());
    expect(store.get(revealInTreeAtom)?.path).toBe("/w/b.md");
    expect(store.get(sidebarOpenAtom)).toBe(false);
    expect(store.get(sidebarTabAtom)).toBe("search");
  });

  it("今のタブをもう一度押すと、左の欄を開いてファイルの面で出す", () => {
    const { store, tab } = show((s) => {
      s.set(sidebarOpenAtom, false);
      s.set(sidebarTabAtom, "search");
    });
    act(() => tab("a.md").click());
    expect(store.get(revealInTreeAtom)?.path).toBe("/w/a.md");
    expect(store.get(sidebarOpenAtom)).toBe(true);
    expect(store.get(sidebarTabAtom)).toBe("files");
  });
});

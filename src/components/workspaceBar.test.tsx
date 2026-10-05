// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { barAtom } from "../state/workspaceBar";
import { WorkspaceBar } from "./WorkspaceBar";

// ワークスペースの列。1 回押せば切り替わり、× では列から外すだけ。

const opened: string[] = [];

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({ openWorkspace: async (ws: Workspace) => void opened.push(ws.id) }),
}));
vi.mock("../hooks/useWorkspaceOps", () => ({
  useWorkspaceOps: () => ({
    renameWorkspace: () => {},
    recolorWorkspace: () => {},
    deleteWorkspace: async () => true,
    openInNewWindow: async () => {},
    createWorkspace: async () => {},
    pickOtherFolder: async () => null,
  }),
}));
vi.mock("../lib/workspaces", async (real) => ({
  ...(await real<typeof import("../lib/workspaces")>()),
  liveWorkspaces: async () => [],
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: async () => false }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
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

const ws = (id: string, name: string): Workspace => ({
  id,
  name,
  color: "teal",
  roots: ["/w"],
  lastOpened: 0,
});

async function show() {
  const store = createStore();
  const list = [ws("a", "要件定義"), ws("b", "Slack 対応"), ws("c", "使わない")];
  store.set(A.workspacesAtom, list);
  store.set(A.workspaceAtom, list[0]);
  store.set(barAtom, ["a", "b"]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Provider store={store}>
        <WorkspaceBar />
      </Provider>,
    );
  });
  return { store, el: host };
}

describe("ワークスペースの列", () => {
  it("列に入れたものだけを、列の順に並べる", async () => {
    const { el } = await show();
    const names = [...el.querySelectorAll("[data-ws] .truncate")].map((n) => n.textContent);
    expect(names).toEqual(["要件定義", "Slack 対応"]);
  });

  it("押せば切り替わる（モーダルを挟まない）", async () => {
    const { el } = await show();
    act(() => (el.querySelector('[data-ws="b"]') as HTMLElement).click());
    expect(opened).toEqual(["b"]);
    expect(document.querySelector(".fixed.inset-0.bg-black\\/40")).toBeNull();
  });

  it("× は列から外すだけで、ワークスペースは残す", async () => {
    const { el, store } = await show();
    const close = el.querySelector('[data-ws="b"] button[title^="列から外す"]') as HTMLElement;
    act(() => close.click());
    expect(store.get(barAtom)).toEqual(["a"]);
    expect(store.get(A.workspacesAtom).map((w) => w.id)).toContain("b");
    expect(opened).toEqual([]);
  });
});

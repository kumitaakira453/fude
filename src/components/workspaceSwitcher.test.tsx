// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

// ⌘⇧P の一覧の「新しく作る」「フォルダを足す」。開いたことのあるフォルダから選べる。

const created: unknown[] = [];
const added: string[][] = [];
const opened: string[] = [];

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    openWorkspace: async () => {},
    openFolder: async (path: string) => void opened.push(path),
    openFolderInNewWindow: async () => true,
  }),
}));
vi.mock("../hooks/useWorkspaceOps", () => ({
  useWorkspaceOps: () => ({
    createWorkspace: async (opts: unknown) => void created.push(opts),
    addRoots: async (roots: string[]) => void added.push(roots),
    pickOtherFolder: async () => null,
    openInNewWindow: async () => {},
    renameWorkspace: () => {},
    recolorWorkspace: () => {},
    deleteWorkspace: async () => true,
    createFromSession: async () => {},
  }),
}));
vi.mock("../lib/workspaces", async (real) => ({
  ...(await real<typeof import("../lib/workspaces")>()),
  liveWorkspaces: async () => [],
  listWorkspaces: async () => [],
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: async () => false }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  created.length = 0;
  added.length = 0;
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

const here: Workspace = {
  id: "ws-1",
  name: "docs",
  color: "teal",
  roots: ["/w/docs"],
  lastOpened: 3,
  folder: "/w/docs",
};

async function show() {
  const store = createStore();
  store.set(A.foldersAtom, [
    { id: "/w/docs", name: "docs", path: "/w/docs", lastOpened: 3 },
    { id: "/w/repo", name: "repo", path: "/w/repo", lastOpened: 2 },
  ]);
  store.set(A.workspaceAtom, here);
  store.set(A.workspacesAtom, [here]);
  store.set(A.workspaceSwitcherOpenAtom, true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Provider store={store}>
        <WorkspaceSwitcher />
      </Provider>,
    );
  });
  return host;
}

const press = (el: Element, key: string, meta = false) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: meta, bubbles: true }));
  });

const button = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!;

describe("新しく作る", () => {
  it("開いたことのあるフォルダが並び、今のフォルダに印が付いている", async () => {
    const el = await show();
    act(() => button(el, "新しく作る").click());
    const text = el.textContent ?? "";
    expect(text).toContain("/w/docs");
    expect(text).toContain("/w/repo");
    expect(text).toContain("1 個のフォルダ");
  });

  it("Enter だけで、今のフォルダの空のワークスペースを作る", async () => {
    const el = await show();
    act(() => button(el, "新しく作る").click());
    press(el.querySelector("input")!, "Enter");
    expect(created).toEqual([{ roots: ["/w/docs"], name: "", newWindow: false }]);
  });

  it("印を足すと、その順に並べる", async () => {
    const el = await show();
    act(() => button(el, "新しく作る").click());
    const input = el.querySelector("input")!;
    press(input, "ArrowDown");
    press(input, " ");
    press(input, "Enter", true);
    expect(created).toEqual([{ roots: ["/w/docs", "/w/repo"], name: "", newWindow: true }]);
  });
});

describe("フォルダを足す", () => {
  it("既に並んでいるフォルダは出さず、選んだものを足す", async () => {
    const el = await show();
    act(() => button(el, "フォルダを足す").click());
    expect(el.textContent).not.toContain("/w/docs");
    press(el.querySelector("input")!, "Enter");
    expect(added).toEqual([["/w/repo"]]);
  });
});

describe("まだワークスペースになっていないフォルダ", () => {
  it("開いたことのあるフォルダを「フォルダ」の区切りに並べ、ワークスペースのあるものは出さない", async () => {
    const el = await show();
    const loose = [...el.querySelectorAll("[data-idx]")]
      .map((r) => r.textContent ?? "")
      .filter((t) => t.includes("/w/"));
    expect(loose).toHaveLength(1);
    expect(loose[0]).toContain("/w/repo");
  });

  it("選ぶとそのフォルダを開く", async () => {
    const el = await show();
    const input = el.querySelector("input")!;
    press(input, "ArrowDown");
    press(input, "Enter");
    expect(opened).toEqual(["/w/repo"]);
  });

  it("画面の言葉は「ウィンドウ」で、「窓」と書かない", async () => {
    const el = await show();
    expect(el.textContent).toContain("このウィンドウ");
    expect(el.textContent).not.toContain("窓");
  });
});

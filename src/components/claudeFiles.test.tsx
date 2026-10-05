// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../lib/workspaces";
import { activeFolderIdAtom, claudeFilesViewAtom, workspaceAtom } from "../state/atoms";
import { ClaudeFiles } from "./ClaudePanel";

// セッションのファイルの欄。一覧と、フォルダごとの木を切り替えられる。

vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: async () => true }));
vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({ openFile: () => {} }),
}));
vi.mock("../hooks/useWorkspaceOps", () => ({
  useWorkspaceOps: () => ({}),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  localStorage.clear();
});

const ws: Workspace = {
  id: "ws",
  name: "調査",
  color: "teal",
  roots: ["/根"],
  lastOpened: 1,
  layout: { kind: "leaf", id: "p1", tabs: [], active: 0 },
  active: "p1",
  claude: {
    sessionId: "s1",
    nameFollows: true,
    wrote: [
      { path: "/根/a/SKILL.md", at: 2 },
      { path: "/根/b/SKILL.md", at: 1 },
    ],
  },
};

function mount() {
  const store = createStore();
  store.set(activeFolderIdAtom, "/根");
  store.set(workspaceAtom, ws);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <ClaudeFiles />
      </Provider>,
    ),
  );
  return store;
}

const toggle = () => host!.querySelector<HTMLElement>(".mg-claude-view")!;

describe("セッションのファイル", () => {
  it("はじめは一覧で、ボタンで木に替わり、選んだ表示を覚える", () => {
    const store = mount();
    expect(host!.querySelector(".mg-claude-tree")).toBeNull();
    expect(toggle().title).toBe("ツリーで表示");
    act(() => toggle().click());
    expect(store.get(claudeFilesViewAtom)).toBe("tree");
    const tree = host!.querySelector(".mg-claude-tree")!;
    // 同じ名前のファイルが、置き場所のフォルダの下に分かれて並ぶ。
    expect(tree.textContent).toContain("a");
    expect(tree.textContent).toContain("b");
    expect(tree.textContent?.match(/SKILL\.md/g)).toHaveLength(2);
    expect(localStorage.getItem("fude:claudefiles")).toBe('"tree"');
  });

  it("木のフォルダを押すと畳める", () => {
    mount();
    act(() => toggle().click());
    const folder = host!.querySelector<HTMLElement>('.mg-claude-tree button[title="a"]')!;
    act(() => folder.click());
    expect(host!.querySelector(".mg-claude-tree")!.textContent?.match(/SKILL\.md/g)).toHaveLength(1);
  });
});

// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../lib/fsAccess";
import { EntryMenu } from "./EntryMenu";

// ファイル・フォルダの右押しメニュー。HTML のファイルにだけ「ブラウザで開く」を出し、
// 既定のブラウザで開く（.html を別のアプリに結び付けていてもブラウザになる）。

const calls: { cmd: string; args: unknown }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: unknown) => {
    calls.push({ cmd, args });
    // 入っているエディタを聞かれたら、無いと答える。
    return cmd === "installed_apps" ? [] : undefined;
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: async () => {},
  confirm: async () => false,
}));
vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    openInNewWindow: async () => {},
    deleteEntry: async () => {},
  }),
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
  calls.length = 0;
});

const node = (name: string, kind: "file" | "dir" = "file"): TreeNode => ({
  kind,
  name,
  path: `/本/${name}`,
  rel: name,
  abs: `/本/${name}`,
});

async function show(target: TreeNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Provider store={createStore()}>
        <EntryMenu menu={{ x: 10, y: 10, node: target }} onClose={() => {}} onRename={() => {}} />
      </Provider>,
    );
  });
}

const item = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(label));

describe("ブラウザで開く", () => {
  it("HTML のファイルに出し、押すと既定のブラウザで開く", async () => {
    await show(node("見本.html"));
    const open = item("ブラウザで開く");
    expect(open).toBeDefined();
    await act(async () => open!.click());
    expect(calls).toContainEqual({ cmd: "open_in_browser", args: { path: "/本/見本.html" } });
  });

  it("Markdown のファイルには出さない", async () => {
    await show(node("メモ.md"));
    expect(item("Finder で表示")).toBeDefined();
    expect(item("ブラウザで開く")).toBeUndefined();
  });

  it("フォルダには出さない（名前が .html で終わっても）", async () => {
    await show(node("site.html", "dir"));
    expect(item("ブラウザで開く")).toBeUndefined();
  });
});

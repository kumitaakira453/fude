// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../lib/fsAccess";
import { soleAtom, treeAtom } from "../state/atoms";
import { FileTree } from "./FileTree";

// 木の上の「新規ファイル / 新規フォルダ」。1 枚だけ開いているときの木は
// そのファイルしか持たないので、作っても出てこない。押せる状態にしない。

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    createFile: async () => {},
    createFolder: async () => {},
    renameEntry: async () => {},
    moveEntry: async () => {},
    openFile: () => {},
    openInNewWindow: async () => {},
  }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const file = (name: string): TreeNode => ({ kind: "file", name, path: name });

let root: Root | null = null;
let host: HTMLElement | null = null;

function show(sole: string | null) {
  const store = createStore();
  store.set(treeAtom, [file("読み物.md")]);
  store.set(soleAtom, sole);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <FileTree />
      </Provider>,
    ),
  );
  return host;
}

const adders = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("button[title]")).filter((b) =>
    (b.getAttribute("title") ?? "").startsWith("ルートに新規"),
  );

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("木の上の作る口", () => {
  it("フォルダを開いているときは出す", () => {
    expect(adders(show(null))).toHaveLength(2);
  });

  it("1 枚だけ開いているときは出さない", () => {
    expect(adders(show("/読み物.md"))).toHaveLength(0);
  });
});

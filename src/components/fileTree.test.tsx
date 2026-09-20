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
//
// 行の操作は ⋯ ひとつに畳む。行ごとに並べる数が違うと、右端が揃わない。

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    createFile: async () => {},
    createFolder: async () => {},
    renameEntry: async () => {},
    moveEntry: async () => {},
    deleteEntry: async () => {},
    openFile: () => {},
    openInNewWindow: async () => {},
    getRootPath: () => "/本",
  }),
}));
vi.mock("../lib/external", () => ({
  availableApps: () => Promise.resolve([]),
  openWith: () => {},
  revealInFinder: () => {},
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: () => Promise.resolve(false) }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const file = (name: string): TreeNode => ({
  kind: "file",
  name,
  path: name,
  abs: `/本/${name}`,
});

const dir = (name: string, children: TreeNode[] = []): TreeNode => ({
  kind: "dir",
  name,
  path: name,
  abs: `/本/${name}`,
  children,
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function show(sole: string | null, tree: TreeNode[] = [file("読み物.md")]) {
  const store = createStore();
  store.set(treeAtom, tree);
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

describe("行の操作", () => {
  const mores = (el: HTMLElement) =>
    Array.from(el.querySelectorAll<HTMLElement>('[aria-label="この項目の操作"]'));
  // 絵は字（リガチャ）で出るので、名前だけを見る。
  const menu = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>("body > div button span.flex-1"),
    ).map((el) => el.textContent ?? "");

  it("フォルダの行にもファイルの行にも、1 つだけ置く", () => {
    const el = show(null, [dir("置き場"), file("読み物.md")]);
    expect(mores(el)).toHaveLength(2);
  });

  it("押すと右押しと同じ中身が出る", () => {
    const el = show(null, [dir("置き場")]);
    act(() => mores(el)[0].click());
    const rows = menu();
    expect(rows).toContain("新規ファイル");
    expect(rows).toContain("新規フォルダ");
    expect(rows).toContain("名前を変更");
    expect(rows).toContain("削除");
  });

  it("ファイルの行からは、そのファイルの操作が出る", () => {
    const el = show(null, [file("読み物.md")]);
    act(() => mores(el)[0].click());
    const rows = menu();
    expect(rows).toContain("横に開く");
    expect(rows).toContain("削除");
    // 作る口はフォルダの行だけ。
    expect(rows).not.toContain("新規フォルダ");
  });
});

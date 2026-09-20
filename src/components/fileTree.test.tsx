// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../lib/fsAccess";
import { activeFolderIdAtom, soleAtom, treeAtom } from "../state/atoms";
import { FileTree } from "./FileTree";

// 木の上の「新規ファイル / 新規フォルダ」。1 枚だけ開いているときの木は
// そのファイルしか持たないので、作っても出てこない。押せる状態にしない。
//
// もう 1 つは外から落とされたものの行き先。落とした行によって入る場所が変わる。

const brought: { dest: string; rels: string[] }[] = [];

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    createFile: async () => {},
    createFolder: async () => {},
    renameEntry: async () => {},
    moveEntry: async () => {},
    intake: async (dest: string, list: { rel: string }[]) => {
      brought.push({ dest, rels: list.map((b) => b.rel) });
    },
    openFile: () => {},
    openInNewWindow: async () => {},
  }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const file = (name: string, at = ""): TreeNode => ({
  kind: "file",
  name,
  path: at ? `${at}/${name}` : name,
  abs: `/本/${at ? `${at}/` : ""}${name}`,
});

const dir = (name: string, children: TreeNode[]): TreeNode => ({
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
  store.set(activeFolderIdAtom, "/本");
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

const rowOf = (el: HTMLElement, path: string) =>
  el.querySelector<HTMLElement>(`[data-path="${path}"]`)!;

// jsdom は DragEvent を持たないので、種別だけ合わせた催しを投げる。
function held(names: string[]): DataTransfer {
  return {
    types: ["Files"],
    files: names.map((n) => new File(["本文"], n)),
    items: [],
    dropEffect: "none",
  } as unknown as DataTransfer;
}

function fire(el: Element, kind: string, data: DataTransfer) {
  const ev = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: data });
  el.dispatchEvent(ev);
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  brought.length = 0;
});

describe("木の上の作る口", () => {
  it("フォルダを開いているときは出す", () => {
    expect(adders(show(null))).toHaveLength(2);
  });

  it("1 枚だけ開いているときは出さない", () => {
    expect(adders(show("/読み物.md"))).toHaveLength(0);
  });
});

describe("外から落とされたもの", () => {
  it("フォルダの行へ落とすと、そのフォルダへ入る", async () => {
    const el = show(null, [dir("資料", [file("表紙.md", "資料")])]);
    await act(async () => {
      fire(rowOf(el, "資料"), "drop", held(["a.md"]));
    });
    expect(brought).toEqual([{ dest: "資料", rels: ["a.md"] }]);
  });

  it("ファイルの行へ落とすと、その行のあるフォルダへ入る", async () => {
    const el = show(null, [dir("資料", [file("表紙.md", "資料")])]);
    // 中の行を出してから落とす。
    act(() => {
      rowOf(el, "資料").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      fire(rowOf(el, "資料/表紙.md"), "drop", held(["a.md"]));
    });
    expect(brought).toEqual([{ dest: "資料", rels: ["a.md"] }]);
  });

  it("行の外へ落とすと、根へ入る", async () => {
    const el = show(null);
    await act(async () => {
      fire(rowOf(el, "読み物.md").parentElement!, "drop", held(["a.md"]));
    });
    expect(brought).toEqual([{ dest: "", rels: ["a.md"] }]);
  });

  it("1 枚だけ開いているときは取り込まない", async () => {
    const el = show("/読み物.md");
    await act(async () => {
      fire(rowOf(el, "読み物.md").parentElement!, "drop", held(["a.md"]));
    });
    expect(brought).toEqual([]);
  });
});

describe("掴んだまま留まったフォルダ", () => {
  it("畳んだフォルダの上に留まると開く", () => {
    vi.useFakeTimers();
    try {
      const el = show(null, [dir("資料", [file("表紙.md", "資料")])]);
      expect(el.querySelector('[data-path="資料/表紙.md"]')).toBeNull();
      fire(rowOf(el, "資料"), "dragover", held(["a.md"]));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(el.querySelector('[data-path="資料/表紙.md"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

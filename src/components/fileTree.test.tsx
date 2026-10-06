// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../lib/fsAccess";
import { rootNode } from "../lib/fsAccess";
import {
  activeFolderIdAtom,
  extraRootsAtom,
  soleAtom,
  treeAtom,
  workspaceAtom,
  workspaceMenuAtom,
  rootCreateAtom,
} from "../state/atoms";
import { FileTree } from "./FileTree";

// 木の上の「新規ファイル / 新規フォルダ」。1 枚だけ開いているときの木は
// そのファイルしか持たないので、作っても出てこない。押せる状態にしない。
//
// もう 1 つは外から落とされたものの行き先。落とした行によって入る場所が変わる。
//
// 最後は行に焦点があるときの打鍵。Enter で名前を変える。

const brought: { dest: string; rels: string[] }[] = [];
const said: string[] = [];

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: async (text: string) => {
    said.push(text);
  },
}));

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
  // jsdom に無いもの。行へ焦点を戻すときに使う。
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s) => s };
});

const file = (name: string, at = ""): TreeNode => ({
  kind: "file",
  name,
  path: `/本/${at ? `${at}/` : ""}${name}`,
  rel: at ? `${at}/${name}` : name,
  abs: `/本/${at ? `${at}/` : ""}${name}`,
});

const dir = (name: string, children: TreeNode[]): TreeNode => ({
  kind: "dir",
  name,
  path: `/本/${name}`,
  rel: name,
  abs: `/本/${name}`,
  children,
});

let root: Root | null = null;
let host: HTMLElement | null = null;

let last: ReturnType<typeof createStore> | null = null;

function show(sole: string | null, tree: TreeNode[] = [file("読み物.md")]) {
  const store = createStore();
  last = store;
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


// 行は絶対パスで見分ける。試験では根（/本）からの相対で指す。
const rowOf = (el: HTMLElement, rel: string) =>
  el.querySelector<HTMLElement>(`[data-path="/本/${rel}"]`)!;

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
  said.length = 0;
});

describe("左の欄の頭の「新規」から根に作る", () => {
  it("フォルダを開いているときは、名前の欄を出す", () => {
    const el = show(null);
    act(() => last!.set(rootCreateAtom, { kind: "file", nonce: 1 }));
    expect(el.querySelector("input")).not.toBeNull();
  });

  it("1 枚だけ開いているときは作らない", () => {
    const el = show("/読み物.md");
    act(() => last!.set(rootCreateAtom, { kind: "file", nonce: 1 }));
    expect(el.querySelector("input")).toBeNull();
  });
});

describe("外から落とされたもの", () => {
  it("フォルダの行へ落とすと、そのフォルダへ入る", async () => {
    const el = show(null, [dir("資料", [file("表紙.md", "資料")])]);
    await act(async () => {
      fire(rowOf(el, "資料"), "drop", held(["a.md"]));
    });
    expect(brought).toEqual([{ dest: "/本/資料", rels: ["a.md"] }]);
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
    expect(brought).toEqual([{ dest: "/本/資料", rels: ["a.md"] }]);
  });

  it("行の外へ落とすと、根へ入る", async () => {
    const el = show(null);
    await act(async () => {
      fire(rowOf(el, "読み物.md").parentElement!, "drop", held(["a.md"]));
    });
    expect(brought).toEqual([{ dest: "/本", rels: ["a.md"] }]);
  });

  it("1 件も読めなければ、黙って終わらせない", async () => {
    const el = show(null);
    await act(async () => {
      fire(rowOf(el, "読み物.md").parentElement!, "drop", held([]));
    });
    expect(brought).toEqual([]);
    expect(said[0]).toContain("読めませんでした");
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
      expect(el.querySelector('[data-path="/本/資料/表紙.md"]')).toBeNull();
      fire(rowOf(el, "資料"), "dragover", held(["a.md"]));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(el.querySelector('[data-path="/本/資料/表紙.md"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("行に焦点があるときの打鍵", () => {
  const key = (el: Element, k: string) =>
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    });
  const frame = () => act(() => new Promise((r) => setTimeout(r, 40)));

  it("Enter で名前の変更に入り、拡張子の前までを選ぶ", () => {
    const el = show(null, [file("learn.py")]);
    rowOf(el, "learn.py").focus();
    key(rowOf(el, "learn.py"), "Enter");
    const input = el.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("learn.py");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  });

  it("フォルダの行でも Enter で名前の変更に入り、名前全体を選ぶ", () => {
    const el = show(null, [dir("資料", [file("表紙.md", "資料")])]);
    rowOf(el, "資料").focus();
    key(rowOf(el, "資料"), "Enter");
    const input = el.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2]);
    // 開け閉めはしない。
    expect(el.querySelector('[data-path="/本/資料/表紙.md"]')).toBeNull();
  });

  it("Escape でやめると、焦点が行へ戻る", async () => {
    const el = show(null, [file("learn.py")]);
    rowOf(el, "learn.py").focus();
    key(rowOf(el, "learn.py"), "Enter");
    key(el.querySelector("input")!, "Escape");
    await frame();
    expect(el.querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(rowOf(el, "learn.py"));
  });
});

describe("フォルダを複数並べているとき", () => {
  let store: ReturnType<typeof createStore>;
  function showTwo() {
    store = createStore();
    store.set(activeFolderIdAtom, "/Users/me/甲");
    store.set(extraRootsAtom, ["/Users/me/work/乙"]);
    store.set(workspaceAtom, {
      id: "ws",
      name: "調べもの",
      color: "rose",
      roots: ["/Users/me/甲", "/Users/me/work/乙"],
      lastOpened: 1,
    });
    store.set(treeAtom, [
      rootNode("/Users/me/甲", "甲", []),
      rootNode("/Users/me/work/乙", "乙", []),
    ]);
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

  it("根の行には、札と同じ色の重なりフォルダの印を付け、置き場所は説明に入れる", () => {
    const el = showTwo();
    const heads = Array.from(el.querySelectorAll<HTMLElement>(".mg-tree-root"));
    expect(heads).toHaveLength(2);
    const mark = heads[1].querySelector<HTMLElement>(".mg-tree-root-mark")!;
    expect(mark.dataset.icon).toBe("folder_copy");
    expect(mark.style.color).toContain("--mg-ws-rose");
    expect(heads[1].title).toBe("/Users/me/work/乙");
    expect(heads[1].textContent).not.toContain("/Users/me");
  });

  it("上の段に並べている数を出し、ボタンでまとめて畳む・開く", () => {
    const el = showTwo();
    expect(el.querySelector(".mg-tree-count")?.textContent).toBe("フォルダ 2");
    const fold = el.querySelector<HTMLElement>(".mg-tree-roots")!;
    // 最初は根の行だけ開いている。
    expect(fold.dataset.tip).toBe("すべてのフォルダを畳む");
    act(() => fold.click());
    expect(el.querySelector<HTMLElement>(".mg-tree-roots")!.dataset.tip).toBe("すべてのフォルダを開く");
  });

  it("「フォルダを追加」で、ワークスペースのメニューをフォルダを選ぶ画面から開く", () => {
    const el = showTwo();
    act(() => el.querySelector<HTMLElement>(".mg-tree-add-root")!.click());
    expect(store.get(workspaceMenuAtom)).toMatchObject({ id: "ws", step: "folders" });
  });

  it("「エクスプローラー」の字は出さない", () => {
    expect(showTwo().textContent).not.toContain("エクスプローラー");
  });

  it("根が 1 つのときは見出しにしない", () => {
    const el = show(null);
    expect(el.querySelector(".mg-tree-root")).toBeNull();
    expect(el.querySelector(".mg-tree-roots")).toBeNull();
  });
});

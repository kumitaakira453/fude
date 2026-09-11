// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocEntry } from "../lib/idb";
import { recentDocsAtom } from "../state/atoms";
import { Landing } from "./Landing";

// スタート画面の「最近のファイル」。一度開いた 1 枚へ戻る入口なので、
// 新しい順に出ること・押すと開くこと・消えたものを引きずらないことを見る。

const opened: string[] = [];
const dropped: string[] = [];
let onDisk = new Set<string>();
let picked: string | null = null;

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    openFolder: async () => {},
    openDoc: async (abs: string) => {
      opened.push(abs);
    },
    refreshFolders: async () => {},
  }),
}));

vi.mock("../lib/fsAccess", async (real) => {
  const mod = await real<typeof import("../lib/fsAccess")>();
  return {
    ...mod,
    pathExists: async (abs: string) => onDisk.has(abs),
    pickDirectory: async () => null,
    pickMarkdownFile: async () => picked,
  };
});

vi.mock("../lib/idb", async (real) => {
  const mod = await real<typeof import("../lib/idb")>();
  return {
    ...mod,
    removeDoc: async (id: string) => {
      dropped.push(id);
      return [];
    },
  };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

const doc = (path: string, lastOpened: number): DocEntry => ({
  id: path,
  name: path.split("/").pop() ?? path,
  path,
  lastOpened,
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function show(docs: DocEntry[]) {
  const store = createStore();
  store.set(recentDocsAtom, docs);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Landing />
      </Provider>,
    ),
  );
  return host;
}

beforeEach(() => {
  opened.length = 0;
  dropped.length = 0;
  onDisk = new Set();
  picked = null;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

// 見出しの下に並ぶ釦。見出しそのものは押せない。
function under(at: HTMLElement, title: string): HTMLElement[] {
  const head = [...at.querySelectorAll("h2")].find((h) => h.textContent === title);
  if (!head) return [];
  return [...(head.nextElementSibling?.querySelectorAll("button") ?? [])];
}

const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

describe("最近のファイル", () => {
  it("新しい順に並び、名前と親フォルダが出る", () => {
    const at = show([
      doc("/Users/me/docs/新しい.md", 200),
      doc("/Users/me/別/古い.md", 100),
    ]);
    const rows = under(at, "最近のファイル");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("新しい");
    expect(rows[0].textContent).toContain("docs");
    expect(rows[1].textContent).toContain("古い");
    expect(rows[1].textContent).toContain("別");
  });

  it("拡張子は落として出す", () => {
    const at = show([doc("/a/設計.md", 1)]);
    expect(under(at, "最近のファイル")[0].textContent).not.toContain(".md");
  });

  it("押すとその 1 枚が開く", async () => {
    onDisk.add("/a/設計.md");
    const at = show([doc("/a/設計.md", 1)]);
    click(under(at, "最近のファイル")[0]);
    await act(async () => {});
    expect(opened).toEqual(["/a/設計.md"]);
  });

  it("実体が無ければ開かず、一覧から落とす", async () => {
    const at = show([doc("/a/消えた.md", 1)]);
    click(under(at, "最近のファイル")[0]);
    await act(async () => {});
    expect(opened).toEqual([]);
    expect(dropped).toEqual(["/a/消えた.md"]);
  });

  it("履歴が無ければ見出しごと出さない", () => {
    const at = show([]);
    expect(under(at, "最近のファイル")).toEqual([]);
  });
});

describe("ファイルを選んで開く", () => {
  it("選んだ 1 枚を開く", async () => {
    picked = "/a/選んだ.md";
    const at = show([]);
    const start = under(at, "スタート");
    const one = start.find((b) => b.textContent?.includes("Markdown ファイル"));
    click(one!);
    await act(async () => {});
    expect(opened).toEqual(["/a/選んだ.md"]);
  });

  it("選ばずに閉じたら何も開かない", async () => {
    const at = show([]);
    const one = under(at, "スタート").find((b) =>
      b.textContent?.includes("Markdown ファイル"),
    );
    click(one!);
    await act(async () => {});
    expect(opened).toEqual([]);
  });
});

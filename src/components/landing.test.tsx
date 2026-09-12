// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocEntry, FolderEntry } from "../lib/idb";
import { foldersAtom, recentDocsAtom } from "../state/atoms";
import { Landing } from "./Landing";

// スタート画面の「最近のファイル」。一度開いた 1 枚へ戻る入口なので、
// 新しい順に出ること・押すと開くこと・消えたものを引きずらないことを見る。

const opened: string[] = [];
const made: string[] = [];
const entered: string[] = [];
let picked: string | null = null;

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    openFolder: async (path: string) => {
      entered.push(path);
    },
    // 実物と同じく、待たずにその場で開く（確かめは開いたあと）。
    openDoc: (abs: string) => {
      opened.push(abs);
    },
    newDraft: async () => {
      made.push("draft");
      return "/drafts/新しい.md";
    },
  }),
}));

vi.mock("../lib/fsAccess", async (real) => {
  const mod = await real<typeof import("../lib/fsAccess")>();
  return {
    ...mod,
    pickDirectory: async () => null,
    pickMarkdownFile: async () => picked,
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

const folder = (path: string, lastOpened: number): FolderEntry => doc(path, lastOpened);

let root: Root | null = null;
let host: HTMLElement | null = null;

function show(docs: DocEntry[], folders: FolderEntry[] = []) {
  const store = createStore();
  store.set(recentDocsAtom, docs);
  store.set(foldersAtom, folders);
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
  entered.length = 0;
  made.length = 0;
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

const cards = (at: HTMLElement) => [
  ...at.querySelectorAll<HTMLElement>(".mg-start-card"),
];
const card = (at: HTMLElement, title: string) =>
  cards(at).find((b) => b.textContent?.includes(title))!;

const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

describe("最近", () => {
  it("フォルダとファイルが 1 本の一覧に混ざり、新しい順に並ぶ", () => {
    const at = show(
      [doc("/Users/me/docs/新しい.md", 300), doc("/Users/me/別/古い.md", 100)],
      [folder("/Users/me/仕事", 200)],
    );
    // 名前は印（アイコン）の字と混ざるので、行の指す道筋で見る。
    expect(under(at, "最近").map((b) => b.title)).toEqual([
      "/Users/me/docs/新しい.md",
      "/Users/me/仕事",
      "/Users/me/別/古い.md",
    ]);
  });

  it("ファイルには親フォルダを添え、拡張子は落とす", () => {
    const at = show([doc("/Users/me/docs/設計.md", 1)]);
    const row = under(at, "最近")[0];
    expect(row.textContent).toContain("設計");
    expect(row.textContent).not.toContain(".md");
    expect(row.textContent).toContain("docs");
  });

  it("ファイルを押すとその 1 枚が開く", () => {
    const at = show([doc("/a/設計.md", 1)]);
    click(under(at, "最近")[0]);
    expect(opened).toEqual(["/a/設計.md"]);
    expect(entered).toEqual([]);
  });

  it("フォルダを押すとフォルダが開く", () => {
    const at = show([], [folder("/a/仕事", 1)]);
    click(under(at, "最近")[0]);
    expect(entered).toEqual(["/a/仕事"]);
    expect(opened).toEqual([]);
  });

  it("履歴が無ければ見出しごと出さない", () => {
    expect(under(show([]), "最近")).toEqual([]);
  });

  it("開く前に実体を確かめない（待たせず先に開く）", () => {
    const at = show([doc("/a/消えたかも.md", 1)]);
    click(under(at, "最近")[0]);
    // 押したその場で開いている。無ければ開いたあとに畳む。
    expect(opened).toEqual(["/a/消えたかも.md"]);
  });
});

describe("開く口", () => {
  it("札は 3 枚。フォルダとファイルと新しいメモ", () => {
    const at = show([]);
    expect(cards(at).length).toBe(3);
    expect(card(at, "フォルダを開く")).toBeTruthy();
    expect(card(at, "ファイルを開く")).toBeTruthy();
    expect(card(at, "新しいメモ")).toBeTruthy();
  });

  it("新しいメモを押すと下書きを作る", () => {
    const at = show([]);
    click(card(at, "新しいメモ"));
    expect(made).toEqual(["draft"]);
  });

  it("選んだ 1 枚を開く", async () => {
    picked = "/a/選んだ.md";
    const at = show([]);
    click(card(at, "ファイルを開く"));
    await act(async () => {});
    expect(opened).toEqual(["/a/選んだ.md"]);
  });

  it("選ばずに閉じたら何も開かない", async () => {
    const at = show([]);
    click(card(at, "ファイルを開く"));
    await act(async () => {});
    expect(opened).toEqual([]);
  });
});

describe("画面の中身", () => {
  it("ショートカットの欄は出さない（⌘/ に全部ある）", () => {
    const at = show([]);
    expect(at.textContent).not.toContain("ショートカット");
    expect(at.textContent).not.toContain("クイックオープン");
  });
});

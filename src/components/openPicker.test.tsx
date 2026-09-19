// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DocEntry } from "../lib/idb";
import {
  foldersAtom,
  openPickerAtom,
  recentDocsAtom,
} from "../state/atoms";
import { OpenPicker } from "./OpenPicker";

// 開くものを選ぶ画面。
//
// 見たいのは「フォルダも 1 枚のファイルも、ここから同じように辿れる」こと。
// 履歴は既に取ってあるのに、開いている最中は辿る道が無いのが元の困りどころ。

const opened: string[] = [];
const docsOpened: string[] = [];

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    openFolder: (path: string) => {
      opened.push(path);
      return Promise.resolve();
    },
    openDoc: (path: string) => {
      docsOpened.push(path);
      return Promise.resolve();
    },
    openFolderInNewWindow: () => Promise.resolve(),
    refreshFolders: () => Promise.resolve(),
    holdDraft: () => false,
  }),
}));

const forgotten: string[] = [];
vi.mock("../lib/idb", async () => {
  const real = await vi.importActual<typeof import("../lib/idb")>("../lib/idb");
  return {
    ...real,
    removeDoc: (id: string) => {
      forgotten.push(id);
      return Promise.resolve([]);
    },
    removeFolder: (id: string) => {
      forgotten.push(id);
      return Promise.resolve([]);
    },
  };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const entry = (path: string, lastOpened: number): DocEntry => ({
  id: path,
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  lastOpened,
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let store: ReturnType<typeof createStore>;

function show(folders: DocEntry[], docs: DocEntry[]) {
  opened.length = 0;
  docsOpened.length = 0;
  forgotten.length = 0;
  store = createStore();
  store.set(foldersAtom, folders);
  store.set(recentDocsAtom, docs);
  store.set(openPickerAtom, true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <OpenPicker />
      </Provider>,
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
});

const rows = () => Array.from(document.querySelectorAll<HTMLElement>(".mg-open-row"));
const names = () =>
  rows().map((el) => el.querySelector("span span")?.textContent ?? "");
const tabs = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".mg-rail-pick > button"));
const tab = (label: string) => tabs().find((el) => el.textContent?.startsWith(label))!;
const field = () => document.querySelector<HTMLInputElement>(".mg-open input")!;
const click = (el: HTMLElement) => act(() => el.click());

const type = (value: string) =>
  act(() => {
    const el = field();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

const key = (k: string) =>
  act(() => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });

const FOLDERS = [entry("/work/monorepo", 300), entry("/work/ark", 100)];
const DOCS = [entry("/notes/あ.md", 200), entry("/notes/い.md", 400)];

describe("タブ", () => {
  it("フォルダとファイルを件数つきで分ける", () => {
    show(FOLDERS, DOCS);
    expect(tabs().slice(0, 2).map((el) => el.textContent)).toEqual([
      "フォルダ 2",
      "ファイル 2",
    ]);
  });

  it("切り替えると中身が入れ替わる", () => {
    show(FOLDERS, DOCS);
    expect(names()).toEqual(["monorepo", "ark"]);
    click(tab("ファイル"));
    expect(names()).toEqual(["い.md", "あ.md"]);
  });
});

describe("絞り込みと並び", () => {
  it("名前にも道筋にも当たる", () => {
    show(FOLDERS, DOCS);
    type("ark");
    expect(names()).toEqual(["ark"]);
    type("work mono");
    expect(names()).toEqual(["monorepo"]);
  });

  it("名前順へ切り替えると並び替わる", () => {
    show(FOLDERS, DOCS);
    // 既定は新しい順。
    expect(names()).toEqual(["monorepo", "ark"]);
    click(tab("名前順"));
    expect(names()).toEqual(["ark", "monorepo"]);
  });

  it("当たりが無ければその旨を出す", () => {
    show(FOLDERS, DOCS);
    type("そんなものはない");
    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).toContain("見つかりません");
  });
});

describe("選ぶ", () => {
  it("押したフォルダを開く", () => {
    show(FOLDERS, DOCS);
    click(rows()[1]);
    expect(opened).toEqual(["/work/ark"]);
  });

  it("ファイルの面で押すと 1 枚で開く", () => {
    show(FOLDERS, DOCS);
    click(tab("ファイル"));
    click(rows()[0]);
    expect(docsOpened).toEqual(["/notes/い.md"]);
  });

  it("↑↓ と Enter で選べる", () => {
    show(FOLDERS, DOCS);
    key("ArrowDown");
    key("Enter");
    expect(opened).toEqual(["/work/ark"]);
  });

  it("Esc で閉じる", () => {
    show(FOLDERS, DOCS);
    key("Escape");
    expect(store.get(openPickerAtom)).toBe(false);
  });
});

describe("履歴から削除", () => {
  it("行の操作から届く（開くのとは別）", () => {
    show(FOLDERS, DOCS);
    click(rows()[0].querySelector<HTMLElement>('[aria-label="履歴から削除"]')!);
    expect(forgotten).toEqual(["/work/monorepo"]);
    expect(opened).toEqual([]);
  });
});

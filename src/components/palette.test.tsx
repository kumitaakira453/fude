// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { keyedCommands, matchCommand } from "../lib/commands";
import * as A from "../state/atoms";
import { useHotkeys } from "../hooks/useHotkeys";
import { CommandPalette } from "./CommandPalette";
import { KeysPane } from "./settings/KeysPane";

// ⌘⇧P：操作とファイルを名前で探す一覧。⌘P はファイルだけ。⌘E は閲覧と編集。

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    openFile: () => {},
    openWorkspace: async () => {},
    holdDraft: () => false,
    newDraft: async () => {},
  }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

function rig() {
  const store = createStore();
  store.set(A.filesAtom, [
    { name: "分割方針.md", path: "/w/分割方針.md", rel: "分割方針.md", abs: "/w/分割方針.md", kind: "file" },
  ]);
  function Keys() {
    useHotkeys();
    return <CommandPalette />;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Keys />
      </Provider>,
    ),
  );
  return store;
}

const key = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
const type = (value: string) =>
  act(() => {
    const input = document.querySelector<HTMLInputElement>("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const words = () =>
  Array.from(document.querySelectorAll(".mg-pick-row")).map((el) => el.textContent ?? "");

describe("⌘⇧P：操作の一覧", () => {
  it("台帳のどの操作も、名前で探すと当たる", () => {
    for (const c of keyedCommands()) expect(matchCommand(c, c.label)).toBe(true);
  });

  it("操作とファイルを同じ欄に並べ、名前で絞り込める", () => {
    const store = rig();
    key({ key: "P", code: "KeyP", metaKey: true, shiftKey: true });
    expect(store.get(A.paletteModeAtom)).toBe("all");
    type("分割");
    const found = words();
    expect(found.some((w) => w.startsWith("右に分割"))).toBe(true);
    expect(found.some((w) => w.startsWith("下に分割"))).toBe(true);
    expect(found.some((w) => w.includes("分割方針"))).toBe(true);
  });

  it("選ぶと一覧を閉じて、その操作を実行する", async () => {
    const store = rig();
    key({ key: "P", code: "KeyP", metaKey: true, shiftKey: true });
    type("サイドバー");
    act(() => {
      document
        .querySelector("input")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(store.get(A.paletteOpenAtom)).toBe(false);
    const before = store.get(A.sidebarOpenAtom);
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 10));
    });
    expect(store.get(A.sidebarOpenAtom)).toBe(!before);
  });

  it("⌘P で開いたときはファイルだけを並べる", () => {
    const store = rig();
    key({ key: "p", code: "KeyP", metaKey: true });
    expect(store.get(A.paletteModeAtom)).toBe("files");
    type("分割");
    expect(words().every((w) => w.includes("分割方針"))).toBe(true);
  });

  it("ファイルの行には、ツリーと同じ絵を名前の頭に出す。Markdown 以外も並ぶ", () => {
    const store = rig();
    store.set(A.filesAtom, [
      { name: "分割方針.md", path: "/w/分割方針.md", rel: "分割方針.md", abs: "/w/分割方針.md", kind: "file" },
      { name: "集計.py", path: "/w/集計.py", rel: "集計.py", abs: "/w/集計.py", kind: "file" },
    ]);
    store.set(A.touchedAtom, new Map([["/w/集計.py", Date.now()]]));
    key({ key: "p", code: "KeyP", metaKey: true });
    const rows = Array.from(document.querySelectorAll(".mg-pick-row"));
    expect(rows[0].textContent).toContain("集計.py");
    expect(rows.every((r) => r.querySelector(".mg-pal-ficon svg, .mg-pal-ficon [data-icon], .mg-pal-ficon *"))).toBe(true);
  });
});

describe("⌘E：閲覧と編集", () => {
  it("押すたびに切り替わる。⌃E（行末へ）は奪わない", () => {
    const store = rig();
    key({ key: "e", code: "KeyE", metaKey: true });
    expect(store.get(A.liveEditAtom)).toBe(true);
    key({ key: "e", code: "KeyE", ctrlKey: true });
    expect(store.get(A.liveEditAtom)).toBe(true);
    key({ key: "e", code: "KeyE", metaKey: true });
    expect(store.get(A.liveEditAtom)).toBe(false);
  });
});

describe("ショートカットの一覧", () => {
  it("台帳のキーは、名前ごと一覧に載っている", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <Provider store={createStore()}>
          <KeysPane query="" />
        </Provider>,
      ),
    );
    const text = host.textContent ?? "";
    for (const c of keyedCommands()) {
      expect(text).toContain(c.keys);
      expect(text).toContain(c.label);
    }
  });
});

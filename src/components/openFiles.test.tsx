// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useRecentFiles } from "../hooks/useRecentFiles";
import * as A from "../state/atoms";
import { OpenFiles } from "./OpenFiles";

// 開いているファイルの一覧（⌘L）。全部のペインのタブを最近見た順に並べ、
// 開いた時点で直前に見ていたものを選んでおく。⏎ でそのタブへ、⌘W で閉じる。

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
});

type Store = ReturnType<typeof createStore>;

function rig(setup: (s: Store) => void) {
  const store = createStore();
  store.set(A.activeFolderIdAtom, "/w");
  store.set(A.layoutAtom, {
    kind: "leaf",
    id: "p1",
    tabs: ["/w/a.md", "/w/docs/b.md", "/w/c.csv"],
    active: 0,
  });
  store.set(A.activePaneIdAtom, "p1");
  setup(store);
  function Probe() {
    useRecentFiles();
    return <OpenFiles />;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Probe />
      </Provider>,
    ),
  );
  return store;
}

const names = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".mg-pal-row .mg-pal-name")).map((r) => r.textContent);
const chosen = () => document.querySelector<HTMLElement>(".mg-pal-row[data-on] .mg-pal-name")?.textContent;
const input = () => document.querySelector<HTMLInputElement>(".mg-pal-in input")!;
const press = (init: KeyboardEventInit) =>
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
const shownTab = (store: Store) => {
  const layout = store.get(A.layoutAtom);
  return layout.kind === "leaf" ? layout.tabs[layout.active] : null;
};

describe("開いているファイルの一覧", () => {
  it("最近見た順に並び、開いた時点で直前に見ていたものを選ぶ", () => {
    const store = rig((s) =>
      s.set(
        A.recentFilesAtom,
        new Map([
          ["/w/c.csv", 2],
          ["/w/docs/b.md", 1],
        ]),
      ),
    );
    // 見ている a.md は、描いた時点でいちばん新しく見たものになる。
    act(() => store.set(A.openFilesOpenAtom, true));
    expect(names()).toEqual(["a.md", "c.csv", "b.md"]);
    expect(chosen()).toBe("c.csv");
  });

  it("⏎ で選んだファイルのタブへ移り、一覧を閉じる", () => {
    const store = rig(() => {});
    act(() => store.set(A.openFilesOpenAtom, true));
    press({ key: "ArrowDown" });
    const target = chosen();
    press({ key: "Enter" });
    expect(shownTab(store)?.endsWith(`/${target}`)).toBe(true);
    expect(store.get(A.openFilesOpenAtom)).toBe(false);
  });

  it("名前で絞り込む", () => {
    const store = rig(() => {});
    act(() => store.set(A.openFilesOpenAtom, true));
    act(() => {
      const el = input();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(el, "csv");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(names()).toEqual(["c.csv"]);
  });

  it("⌘W で選んでいる行のタブを閉じ、一覧は開いたまま", () => {
    const store = rig(() => {});
    act(() => store.set(A.openFilesOpenAtom, true));
    const target = chosen()!;
    press({ key: "w", metaKey: true });
    expect(names()).not.toContain(target);
    expect(store.get(A.openFilesOpenAtom)).toBe(true);
  });

  it("右の中身は選んだ行のもの（場所は全部の道筋）", () => {
    const store = rig(() => {});
    act(() => store.set(A.openFilesOpenAtom, true));
    press({ key: "ArrowUp" });
    const detail = document.querySelector(".mg-pal-detail")!.textContent ?? "";
    expect(detail).toContain("/w/a.md");
    expect(detail).toContain("見ている");
  });
});

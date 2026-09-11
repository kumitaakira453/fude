// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider, createStore } from "jotai";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activeFolderIdAtom,
  activePaneIdAtom,
  layoutAtom,
  savedLayoutsAtom,
  sessionLayoutsAtom,
  type LayoutNode,
} from "../state/atoms";
import { useKeepLayout } from "./useKeepLayout";

// レイアウトの控え。フォルダごとに分けて持つので、開いているフォルダが変わる
// 瞬間に前のフォルダの中身を書いてしまうと、戻ってきたときにタブが空になる。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

const leaf = (id: string, tabs: string[]): LayoutNode => ({
  kind: "leaf",
  id,
  tabs,
  active: 0,
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function Keep() {
  useKeepLayout();
  return null;
}

function mount(store: ReturnType<typeof createStore>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Keep />
      </Provider>,
    ),
  );
}

// フォルダを開く。控えを先に読み、開いているフォルダを変えてから戻す
// （useWorkspace.openFolder と同じ順）。
function openFolder(store: ReturnType<typeof createStore>, id: string) {
  const saved = store.get(savedLayoutsAtom)[id];
  act(() => {
    store.set(activeFolderIdAtom, id);
    store.set(layoutAtom, leaf("p1", []));
  });
  act(() => {
    if (saved) {
      store.set(layoutAtom, saved.layout);
      store.set(activePaneIdAtom, saved.active);
    }
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  localStorage.clear();
});

describe("レイアウトの控え", () => {
  it("同じフォルダでレイアウトが変われば控える", () => {
    const store = createStore();
    store.set(activeFolderIdAtom, "/A");
    mount(store);

    act(() => store.set(layoutAtom, leaf("p1", ["/A/一.md"])));
    expect(store.get(savedLayoutsAtom)["/A"].layout).toEqual(
      leaf("p1", ["/A/一.md"]),
    );
    expect(store.get(sessionLayoutsAtom)["/A"].layout).toEqual(
      leaf("p1", ["/A/一.md"]),
    );
  });

  it("フォルダが変わった直後は、前のレイアウトを新しい鍵で書かない", () => {
    const store = createStore();
    store.set(activeFolderIdAtom, "/A");
    mount(store);
    act(() => store.set(layoutAtom, leaf("p1", ["/A/一.md"])));

    // レイアウトは前のフォルダのまま、開いているフォルダだけ変わる
    act(() => store.set(activeFolderIdAtom, "/B"));
    expect(store.get(savedLayoutsAtom)["/B"]).toBeUndefined();
  });

  it("フォルダを行き来しても、それぞれのタブが残る", () => {
    const store = createStore();
    mount(store);

    openFolder(store, "/A");
    act(() => store.set(layoutAtom, leaf("p1", ["/A/一.md"])));
    openFolder(store, "/B");
    act(() => store.set(layoutAtom, leaf("p1", ["/B/二.md"])));
    // 呼ぶ側が先に開いているフォルダを変えても潰れない
    act(() => store.set(activeFolderIdAtom, "/A"));
    openFolder(store, "/A");

    expect(store.get(layoutAtom)).toEqual(leaf("p1", ["/A/一.md"]));
    expect(store.get(savedLayoutsAtom)["/B"].layout).toEqual(
      leaf("p1", ["/B/二.md"]),
    );
  });
});

// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { activePaneIdAtom, layoutAtom, metaOpenAtom, railAtom } from "../state/atoms";
import { useHotkeys } from "./useHotkeys";

// 窓ぜんたいで受けるキー操作。見るのは ⌘⇧M（活きているペインのメタ情報だけが
// 開け閉めされる）と、右の欄を切り替える ⌘⇧O / ⌘⇧K。

// 右の欄を出せるかは窓の広さで決まる。jsdom は matchMedia を持たないので、
// 広さを test 側から決められるようにしておく。
let wide = true;
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: wide, media: query }),
  });
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function Keys() {
  useHotkeys();
  return null;
}

function rig() {
  const store = createStore();
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

const press = (key: string, mod: { shift?: boolean } = {}) =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        metaKey: true,
        shiftKey: !!mod.shift,
        bubbles: true,
      }),
    );
  });

describe("⌘⇧M", () => {
  it("活きているペインの id が入る", () => {
    const store = rig();
    store.set(activePaneIdAtom, "p2");
    press("M", { shift: true });
    expect(store.get(metaOpenAtom)).toBe("p2");
  });

  it("もう一度押すと閉じる", () => {
    const store = rig();
    press("M", { shift: true });
    press("M", { shift: true });
    expect(store.get(metaOpenAtom)).toBe(null);
  });

  it("別のペインへ移ってから押すと、そちらへ移る", () => {
    const store = rig();
    press("M", { shift: true });
    store.set(activePaneIdAtom, "p2");
    press("M", { shift: true });
    expect(store.get(metaOpenAtom)).toBe("p2");
  });

  it("⇧ が無ければ何も起きない", () => {
    const store = rig();
    press("m");
    expect(store.get(metaOpenAtom)).toBe(null);
  });
});

describe("右の欄", () => {
  it("⌘⇧O で目次が出て、もう一度押すと畳む", () => {
    const store = rig();
    store.set(railAtom, "none");
    press("O", { shift: true });
    expect(store.get(railAtom)).toBe("toc");
    press("O", { shift: true });
    expect(store.get(railAtom)).toBe("none");
  });

  it("⌘⇧K はコメントの欄。目次が出ていても置き換わる", () => {
    const store = rig();
    store.set(railAtom, "toc");
    press("K", { shift: true });
    expect(store.get(railAtom)).toBe("comments");
  });

  it("分割しているあいだは切り替わらない", () => {
    const store = rig();
    store.set(railAtom, "none");
    store.set(layoutAtom, {
      kind: "split",
      id: "s1",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        { kind: "leaf", id: "p1", tabs: [], active: 0 },
        { kind: "leaf", id: "p2", tabs: [], active: 0 },
      ],
    });
    press("O", { shift: true });
    expect(store.get(railAtom)).toBe("none");
  });

  it("窓が狭いときは切り替わらない", () => {
    const store = rig();
    store.set(railAtom, "none");
    wide = false;
    press("O", { shift: true });
    expect(store.get(railAtom)).toBe("none");
    wide = true;
  });
});

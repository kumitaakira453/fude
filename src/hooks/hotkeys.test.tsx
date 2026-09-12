// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { activePaneIdAtom, metaOpenAtom } from "../state/atoms";
import { useHotkeys } from "./useHotkeys";

// 窓ぜんたいで受けるキー操作。ここで見るのは ⌘⇧M で、活きているペインの
// メタ情報だけが開け閉めされること。

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

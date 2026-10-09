// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activePaneIdAtom,
  csvViewAtom,
  jsonViewAtom,
  layoutAtom,
  metaOpenAtom,
  railAtom,
  settingsFaceAtom,
  settingsOpenAtom,
} from "../state/atoms";
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

describe("⌘⇧V", () => {
  const showing = (path: string) => {
    const store = rig();
    store.set(layoutAtom, { kind: "leaf", id: "p1", tabs: [path], active: 0 });
    store.set(activePaneIdAtom, "p1");
    return store;
  };

  it("CSV を出しているときは、原文と表を切り替える", () => {
    const store = showing("data/表.csv");
    press("V", { shift: true });
    expect(store.get(csvViewAtom)).toBe("table");
    press("V", { shift: true });
    expect(store.get(csvViewAtom)).toBe("rainbow");
  });

  it("CSV でなければ受けない（書式を落とした貼り付けに通す）", () => {
    const store = showing("読み物.md");
    press("V", { shift: true });
    expect(store.get(csvViewAtom)).toBe("rainbow");
  });
});

describe("⌘⇧V（JSON）", () => {
  it("JSON を出しているときは、木と原文を切り替え、CSV の見た目には触らない", () => {
    const store = rig();
    store.set(layoutAtom, { kind: "leaf", id: "p1", tabs: ["data/設定.json"], active: 0 });
    store.set(activePaneIdAtom, "p1");
    store.set(jsonViewAtom, "tree");
    store.set(csvViewAtom, "rainbow");
    press("V", { shift: true });
    expect(store.get(jsonViewAtom)).toBe("source");
    expect(store.get(csvViewAtom)).toBe("rainbow");
    press("V", { shift: true });
    expect(store.get(jsonViewAtom)).toBe("tree");
  });
});

describe("⌘/", () => {
  it("設定のキー操作の面を開き、もう一度で閉じる", () => {
    const store = rig();
    press("/");
    expect(store.get(settingsOpenAtom)).toBe(true);
    expect(store.get(settingsFaceAtom)).toBe("keys");
    press("/");
    expect(store.get(settingsOpenAtom)).toBe(false);
  });
});

// 全画面の窓は、ページが受けなかった Esc で全画面をやめる。Esc はほかの受け手が
// すべて走った後で止め、窓へは渡さない。
describe("Esc を窓へ渡さない", () => {
  const esc = (init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });
    act(() => {
      document.body.dispatchEvent(e);
    });
    return e;
  };

  it("ほかの受け手の後で止める。後から付いた受け手も、止められる前の Esc を受ける", () => {
    rig();
    const seen: boolean[] = [];
    const later = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
    window.addEventListener("keydown", later);
    const e = esc();
    window.removeEventListener("keydown", later);
    expect(seen).toEqual([false]);
    expect(e.defaultPrevented).toBe(true);
  });

  it("変換中の Esc と、Esc 以外のキーは止めない", () => {
    rig();
    expect(esc({ isComposing: true }).defaultPrevented).toBe(false);
    const a = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(a);
    });
    expect(a.defaultPrevented).toBe(false);
  });
});

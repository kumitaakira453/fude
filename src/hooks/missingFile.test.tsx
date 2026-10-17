// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as A from "../state/atoms";
import { toastAtom } from "../state/toast";
import { useWorkspace } from "./useWorkspace";

// 消えた・移したファイルを開いたとき。本文が入らないまま面が読み込み中で止まらない
// よう、無いと分かったらタブを外して知らせる。

const there = new Set(["/本/ある.md"]);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => (cmd === "scan_tree" || cmd === "folder_mtimes" ? [] : null),
}));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: () => Promise.resolve("/data") }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: () => Promise.resolve() }));
vi.mock("../lib/fsAccess", async (real) => ({
  ...(await real<typeof import("../lib/fsAccess")>()),
  readFile: async (abs: string) => {
    if (!there.has(abs)) throw new Error(`No such file: ${abs}`);
    return { text: "# 本文\n", lastModified: 1 };
  },
  pathExists: async (abs: string) => there.has(abs),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function rig() {
  const store = createStore();
  let ws: ReturnType<typeof useWorkspace> | null = null;
  function Probe() {
    ws = useWorkspace();
    return null;
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
  return { store, ws: () => ws! };
}

const tabs = (store: ReturnType<typeof createStore>) => {
  const layout = store.get(A.layoutAtom);
  return layout.kind === "leaf" ? layout.tabs : [];
};

const settle = () =>
  act(async () => {
    await new Promise((ok) => setTimeout(ok, 10));
  });

describe("消えたファイルを開く", () => {
  it("タブを外して、もう無いと知らせる", async () => {
    const r = rig();
    act(() => r.ws().openFile("/本/消えた.md"));
    expect(tabs(r.store)).toEqual(["/本/消えた.md"]);
    await settle();
    expect(tabs(r.store)).toEqual([]);
    expect(JSON.stringify(r.store.get(toastAtom))).toContain("そのファイルはもうありません");
  });

  it("あるファイルはタブを残し、本文が入る", async () => {
    const r = rig();
    act(() => r.ws().openFile("/本/ある.md"));
    await settle();
    expect(tabs(r.store)).toEqual(["/本/ある.md"]);
    expect(r.store.get(A.contentCacheAtom).get("/本/ある.md")).toBe("# 本文\n");
  });

  describe("外した後にどのタブを選ぶか", () => {
    const lay = (store: ReturnType<typeof createStore>, list: string[], active: number) =>
      store.set(A.layoutAtom, { kind: "leaf", id: "p1", tabs: list, active });
    const shown = (store: ReturnType<typeof createStore>) => {
      const layout = store.get(A.layoutAtom);
      return layout.kind === "leaf" ? layout.tabs[layout.active] : null;
    };

    it("押す前に見ていたタブへ戻す（右隣へ繰り上げない）", async () => {
      // 右隣には、外から足された別のファイルが並んでいる。
      const r = rig();
      lay(r.store, ["/本/A.md", "/本/B.md", "/本/C.md"], 0);
      act(() => r.ws().openFile("/本/消えた.md"));
      expect(shown(r.store)).toBe("/本/消えた.md");
      await settle();
      expect(tabs(r.store)).toEqual(["/本/A.md", "/本/B.md", "/本/C.md"]);
      expect(shown(r.store)).toBe("/本/A.md");
    });

    it("読み終わる前に別のタブへ移っていたら、そのまま", async () => {
      const r = rig();
      lay(r.store, ["/本/A.md", "/本/B.md", "/本/C.md"], 0);
      act(() => r.ws().openFile("/本/消えた.md"));
      // 消えた.md は A の右隣（1 番目）に入った。C（3 番目）へ移る。
      act(() => lay(r.store, tabs(r.store), 3));
      await settle();
      expect(shown(r.store)).toBe("/本/C.md");
    });

    it("押して開いたのでないもの（戻したタブなど）は、左隣を選ぶ", async () => {
      const r = rig();
      lay(r.store, ["/本/A.md", "/本/消えた.md", "/本/B.md"], 1);
      await act(async () => {
        await r.ws().reloadFile("/本/消えた.md");
      });
      expect(tabs(r.store)).toEqual(["/本/A.md", "/本/B.md"]);
      expect(shown(r.store)).toBe("/本/A.md");
    });
  });

  it("1 枚だけで開いているファイルは、ここでは外さない（開く側が畳む）", async () => {
    const r = rig();
    r.store.set(A.soleAtom, "/本/消えた.md");
    act(() => r.ws().openFile("/本/消えた.md"));
    await settle();
    expect(tabs(r.store)).toEqual(["/本/消えた.md"]);
  });
});

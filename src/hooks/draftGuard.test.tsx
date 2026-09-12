// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as A from "../state/atoms";
import { useWorkspace } from "./useWorkspace";

// 下書きを開いたまま別の画面へ移らないための関所。
//
// 書きかけを 2 つ以上持たせない決めごとなので、ここが抜けると保存先の
// 決まっていないメモが溜まる。打った字を黙って消さないことも一緒に見る。

vi.mock("@tauri-apps/api/path", () => ({ appDataDir: () => Promise.resolve("/data") }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: () => Promise.resolve(null),
  message: () => Promise.resolve(),
}));
vi.mock("../lib/drafts", async (real) => {
  const mod = await real<typeof import("../lib/drafts")>();
  return { ...mod, dropDraft: async () => dropped.push("x") as unknown as void };
});

const dropped: string[] = [];
const DIR = "/data/drafts";
const DRAFT = `${DIR}/20260912-140125-275.md`;
const REL = "20260912-140125-275.md";

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
  dropped.length = 0;
});

function rig(cache: Map<string, string>) {
  const store = createStore();
  store.set(A.draftsDirAtom, DIR);
  store.set(A.soleAtom, DRAFT);
  store.set(A.contentCacheAtom, cache);

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

describe("下書きから離れるとき", () => {
  it("書いてあるなら、フォルダを開かずに問う", async () => {
    const r = rig(new Map([[REL, "書いた本文\n"]]));
    await act(async () => {
      await r.ws().openFolder("/どこか");
    });
    expect(r.store.get(A.draftAskAtom)?.path).toBe(DRAFT);
    // 行き先へは進んでいない。
    expect(r.store.get(A.activeFolderIdAtom)).toBe(null);
    expect(dropped).toEqual([]);
  });

  it("問いに答えたあと、元の行き先へ続けられる", async () => {
    const r = rig(new Map([[REL, "書いた本文\n"]]));
    await act(async () => {
      await r.ws().openFolder("/どこか");
    });
    expect(typeof r.store.get(A.draftAskAtom)?.go).toBe("function");
  });

  it("問いの値を promise と見間違えさせない", async () => {
    // jotai は atom の値に then が生えていると promise と見なし、読んだ部品を
    // Suspense で止める。止まる先が無いので画面ごと消え、押しても何も起きなく
    // なる。実際にこれで DocPane が止まった。
    const r = rig(new Map([[REL, "書いた本文\n"]]));
    await act(async () => {
      await r.ws().openFolder("/どこか");
    });
    const ask = r.store.get(A.draftAskAtom) as unknown as Record<string, unknown>;
    expect(typeof ask.then).not.toBe("function");
  });

  it("空だと分かっているものは問わずに捨てて通す", async () => {
    const r = rig(new Map([[REL, "\n  \n"]]));
    let held = true;
    act(() => {
      held = r.ws().holdDraft(() => {});
    });
    expect(held).toBe(false);
    expect(dropped).toEqual(["x"]);
    expect(r.store.get(A.draftAskAtom)).toBe(null);
  });

  it("控えがまだ無いときは、空と決めつけずに問う", async () => {
    const r = rig(new Map());
    let held = false;
    act(() => {
      held = r.ws().holdDraft(() => {});
    });
    expect(held).toBe(true);
    expect(dropped).toEqual([]);
  });

  it("下書きでなければ素通りする", () => {
    const r = rig(new Map([[REL, "書いた本文\n"]]));
    act(() => {
      r.store.set(A.soleAtom, "/どこか/普通.md");
    });
    let held = true;
    act(() => {
      held = r.ws().holdDraft(() => {});
    });
    expect(held).toBe(false);
    expect(r.store.get(A.draftAskAtom)).toBe(null);
  });
});

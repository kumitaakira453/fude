// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider, createStore } from "jotai";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { contentCacheAtom } from "../../state/atoms";
import { useFileBody } from "./useFileBody";

// レビュー画面は本文を控え（contentCacheAtom）からしか見ていなかったので、
// 一度も開いていないファイルの指摘が「フォルダの中にない」と出ていた。
// 出す直前に読みに行き、読めたら出す。

const read: string[] = [];
let answer: (path: string) => Promise<void> = async () => {};

vi.mock("../../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    reloadFile: (path: string) => {
      read.push(path);
      return answer(path);
    },
  }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function show(store: ReturnType<typeof createStore>, rel: string | null) {
  function Peek() {
    const { body, reading } = useFileBody(rel);
    return (
      <div>
        <span id="body">{body ?? "(なし)"}</span>
        <span id="reading">{String(reading)}</span>
      </div>
    );
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Peek />
      </Provider>,
    ),
  );
  return {
    body: () => host!.querySelector("#body")!.textContent,
    reading: () => host!.querySelector("#reading")!.textContent,
  };
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  read.length = 0;
  answer = async () => {};
});

describe("指摘のファイルの本文", () => {
  it("控えに無ければ読みに行き、読めたら出す", async () => {
    const store = createStore();
    answer = async (path) => {
      store.set(contentCacheAtom, new Map([[path, "読んだ本文"]]));
    };
    const peek = show(store, "docs/a.md");
    expect(read).toEqual(["docs/a.md"]);
    await act(async () => {});
    expect(peek.body()).toBe("読んだ本文");
    expect(peek.reading()).toBe("false");
  });

  it("控えにあれば読みに行かない", () => {
    const store = createStore();
    store.set(contentCacheAtom, new Map([["docs/a.md", "もう在る"]]));
    const peek = show(store, "docs/a.md");
    expect(read).toEqual([]);
    expect(peek.body()).toBe("もう在る");
  });

  it("前書きは落として本文だけ出す", () => {
    const store = createStore();
    store.set(contentCacheAtom, new Map([["docs/a.md", "---\ntitle: 題\n---\n本文\n"]]));
    const peek = show(store, "docs/a.md");
    expect(peek.body()).toBe("本文\n");
  });

  it("フォルダの外（パスが無い）なら読みに行かない", () => {
    const peek = show(createStore(), null);
    expect(read).toEqual([]);
    expect(peek.body()).toBe("(なし)");
  });

  it("読めなかったファイルは叩き直さない", async () => {
    const store = createStore();
    answer = async () => {
      // 読めないまま（控えは増えない）
    };
    const peek = show(store, "docs/無い.md");
    await act(async () => {});
    expect(peek.body()).toBe("(なし)");
    expect(peek.reading()).toBe("false");
    // 描き直しても 1 回きり
    act(() => store.set(contentCacheAtom, new Map([["docs/別.md", "他"]])));
    expect(read).toEqual(["docs/無い.md"]);
  });
});

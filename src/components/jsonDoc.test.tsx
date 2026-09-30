// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { jsonViewAtom } from "../state/atoms";
import { JsonDoc } from "./JsonDoc";

// JSON は開け閉めできる木で開き、2 段目まで開いた形で始まる。読めない中身は原文で出す。

const DOC = JSON.stringify({ name: "fude", tags: ["a", "b"], meta: { deep: { x: 1 }, ok: true } });
let content = DOC;
vi.mock("../lib/fsAccess", () => ({
  readText: async () => content,
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom に無いもの。小窓の位置を探すときに使う。
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s) => s };
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  content = DOC;
});

async function show() {
  const store = createStore();
  // 見た目は保存領域に残るので、試験ごとに木から始める。
  store.set(jsonViewAtom, "tree");
  host = document.createElement("div");
  host.style.overflowY = "auto";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Provider store={store}>
        <JsonDoc abs="/本/設定.json" />
      </Provider>,
    );
  });
  return { el: host, store };
}

const lines = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>(".mg-json-row")].map((r) => r.textContent);
const button = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(".mg-imgdoc-bar button")].find((b) => b.textContent === label)!;
const row = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLElement>(".mg-json-row")].find((r) => r.textContent?.startsWith(text))!;

describe("JSON を読む", () => {
  it("開くと 2 段目まで開いた木で出る。閉じた項目には中身の数を添える", async () => {
    const { el } = await show();
    expect(lines(el)).toEqual([
      "{3 個",
      'name:"fude"',
      "tags:[2 件",
      "0:\"a\"",
      "1:\"b\"",
      "meta:{2 個",
      "deep:{…}1 個",
      "ok:true",
    ]);
    expect(el.querySelector(".mg-imgdoc-size")!.textContent).toBe("JSON · 9 項目");
  });

  it("行を押すと開け閉めし、⌥ を押しながらなら下までまとめて", async () => {
    const { el } = await show();
    act(() => row(el, "deep").click());
    expect(lines(el)).toContain("x:1");
    act(() => row(el, "meta").click());
    expect(lines(el).some((l) => l?.startsWith("deep"))).toBe(false);
    act(() => {
      row(el, "meta").dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
    });
    expect(lines(el)).toContain("x:1");
  });

  it("「すべて閉じる」「すべて開く」", async () => {
    const { el } = await show();
    act(() => button(el, "すべて閉じる").click());
    expect(lines(el)).toEqual(["{…}3 個"]);
    act(() => button(el, "すべて開く").click());
    expect(lines(el)).toContain("x:1");
  });

  it("釦で原文に替わり、もう一度で木に戻る", async () => {
    const { el, store } = await show();
    act(() => button(el, "原文で見る").click());
    expect(store.get(jsonViewAtom)).toBe("source");
    expect(el.querySelector(".mg-json")).toBeNull();
    expect(el.querySelector(".mg-source")).not.toBeNull();
    act(() => button(el, "木で見る").click());
    expect(el.querySelector(".mg-json")).not.toBeNull();
  });

  it("JSON として読めない中身は原文で出し、そう知らせる", async () => {
    content = '{ "a": 1, // コメント\n}';
    const { el } = await show();
    expect(el.querySelector(".mg-json")).toBeNull();
    expect(el.querySelector(".mg-source")).not.toBeNull();
    expect(el.querySelector(".mg-imgdoc-size")!.textContent).toBe("JSON として読めませんでした");
    expect(button(el, "木で見る")).toBeUndefined();
  });
});

describe("行の選択と全文の小窓", () => {
  const key = (el: HTMLElement, k: string) =>
    act(() => {
      el.querySelector(".mg-json")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
      );
    });
  const selected = (el: HTMLElement) => el.querySelector<HTMLElement>(".mg-json-row.is-sel")?.dataset.path;

  it("押した行を選び、上下で動き、← で親へ上がる", async () => {
    const { el } = await show();
    act(() => row(el, "name").click());
    expect(selected(el)).toBe("$.name");
    key(el, "ArrowDown");
    key(el, "ArrowDown");
    expect(selected(el)).toBe("$.tags[0]");
    key(el, "ArrowLeft");
    expect(selected(el)).toBe("$.tags");
    // 開いている項目の上の ← は閉じる。
    key(el, "ArrowLeft");
    expect(lines(el)).toContain("tags:[…]2 件");
    key(el, "ArrowRight");
    expect(lines(el)).toContain('0:"a"');
  });

  it("Enter で値の全文を小窓に出し、中が JSON の文字列は字下げする", async () => {
    content = JSON.stringify({ log: '{"level":"INFO","n":1}', long: "x".repeat(500) });
    const { el } = await show();
    act(() => row(el, "log").click());
    key(el, "Enter");
    const peek = document.querySelector(".mg-csv-peek")!;
    expect(peek.querySelector(".mg-csv-peek-label")!.textContent).toBe("$.log · JSON");
    expect(peek.querySelector(".mg-csv-peek-body")!.textContent).toBe('{\n  "level": "INFO",\n  "n": 1\n}');
    // 小窓を出したまま動くと、小窓も動いた先の値になる。
    key(el, "ArrowDown");
    expect(document.querySelector(".mg-csv-peek-body")!.textContent).toBe("x".repeat(500));
    key(el, "Escape");
    expect(document.querySelector(".mg-csv-peek")).toBeNull();
    expect(selected(el)).toBe("$.long");
  });
});

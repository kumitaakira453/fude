// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { csvViewAtom, csvWidthsAtom } from "../state/atoms";
import { CsvDoc } from "./CsvDoc";

// CSV は列ごとの色の原文で開き、釦で表に替わる。表では 1 行目をヘッダー行に置く。

let content = '名前,点\n"山田, 太郎",90\n鈴木,80\n';
vi.mock("../lib/fsAccess", () => ({
  readText: async () => content,
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
  content = '名前,点\n"山田, 太郎",90\n鈴木,80\n';
});

async function show() {
  const store = createStore();
  // 見た目は保存領域に残るので、試験ごとに原文の見た目から始める。
  store.set(csvViewAtom, "rainbow");
  store.set(csvWidthsAtom, {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Provider store={store}>
        <CsvDoc abs="/本/表.csv" />
      </Provider>,
    );
  });
  return { el: host, store };
}

const button = (el: HTMLElement) => el.querySelector<HTMLButtonElement>(".mg-imgdoc-bar button")!;

describe("CSV を読む", () => {
  it("開くと、列ごとに色を付けた原文で出る", async () => {
    const { el } = await show();
    expect(el.querySelector("table")).toBeNull();
    const first = el.querySelector(".mg-source-line")!;
    expect([...first.querySelectorAll("[class^=mg-csv-c]")].map((s) => s.className)).toEqual([
      "mg-csv-c0",
      "mg-csv-c1",
    ]);
    expect(el.querySelector(".mg-imgdoc-size")!.textContent).toBe("CSV · 3 行 × 2 列");
    expect(button(el).textContent).toBe("表で見る");
  });

  it("釦で表に替わり、1 行目はヘッダー行、囲みの中のカンマは値の一部", async () => {
    const { el, store } = await show();
    act(() => button(el).click());
    expect(store.get(csvViewAtom)).toBe("table");
    const head = [...el.querySelectorAll(".mg-csv-head th:not(.mg-csv-no)")].map((c) => c.textContent);
    expect(head).toEqual(["名前", "点"]);
    const cells = [...el.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((c) => c.textContent),
    );
    expect(cells).toEqual([
      ["山田, 太郎", "90"],
      ["鈴木", "80"],
    ]);
    // 列の名前と行番号は字として置かない。
    expect(el.querySelector(".mg-csv-letters")!.textContent).toBe("");
    act(() => button(el).click());
    expect(el.querySelector("table")).toBeNull();
  });
});

describe("表の升目", () => {
  const table = async () => {
    const shown = await show();
    act(() => button(shown.el).click());
    return shown.el;
  };

  it("1 行おきに地を変える（表の中の位置で数える）", async () => {
    const el = await table();
    expect([...el.querySelectorAll("tbody tr")].map((tr) => tr.className)).toEqual(["", "is-even"]);
  });

  it("押しただけでは小窓を出さず、選んで Enter で全文を出す。JSON は字下げする", async () => {
    content = 'ログ\n"{""a"":1,\n""b"":[2]}"\n';
    const el = await table();
    const cell = el.querySelector("tbody td")!;
    act(() => {
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector(".mg-csv-peek")).toBeNull();
    expect(cell.classList.contains("is-sel")).toBe(true);
    const t = el.querySelector("table")!;
    const press = (key: string) =>
      act(() => {
        t.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      });
    press("Enter");
    const peek = document.querySelector(".mg-csv-peek")!;
    expect(peek.querySelector(".mg-csv-peek-body")!.textContent).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
    expect(peek.textContent).toContain("A2 · JSON");
    expect(peek.querySelector("button")!.textContent).toBe("コピー");
    // Esc は小窓だけを閉じ、選択は残す。
    press("Escape");
    expect(document.querySelector(".mg-csv-peek")).toBeNull();
    expect(cell.classList.contains("is-sel")).toBe(true);
    // もう一度 Enter で出し、Enter で閉じる。
    press("Enter");
    expect(document.querySelector(".mg-csv-peek")).not.toBeNull();
    press("Enter");
    expect(document.querySelector(".mg-csv-peek")).toBeNull();
  });
});

describe("升目の選択と列の幅", () => {
  const table = async () => {
    const shown = await show();
    act(() => button(shown.el).click());
    return shown;
  };
  const key = (el: Element, k: string) =>
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    });
  const selected = (el: HTMLElement) => {
    const c = el.querySelector<HTMLElement>(".is-sel");
    return c && `${c.dataset.r},${c.dataset.c}`;
  };

  it("押した升目を選び、矢印で上下左右へ動かす。端では止まる", async () => {
    const { el } = await table();
    act(() => {
      el.querySelector("tbody td")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const t = el.querySelector("table")!;
    expect(selected(el)).toBe("1,0");
    key(t, "ArrowRight");
    expect(selected(el)).toBe("1,1");
    key(t, "ArrowRight");
    expect(selected(el)).toBe("1,1");
    key(t, "ArrowDown");
    expect(selected(el)).toBe("2,1");
    key(t, "ArrowUp");
    key(t, "ArrowUp");
    // ヘッダー行（0 行目）まで上がれる。
    expect(selected(el)).toBe("0,1");
    key(t, "Escape");
    expect(selected(el)).toBeNull();
  });

  it("小窓を出したまま矢印で動かすと、小窓も動いた先の升目の全文になる", async () => {
    content = 'a,b\n1,"x\ny"\n';
    const { el } = await table();
    act(() => {
      el.querySelector("tbody td")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const t = el.querySelector("table")!;
    key(t, "Enter");
    const body = () => document.querySelector(".mg-csv-peek-body")!.textContent;
    expect(body()).toBe("1");
    key(t, "ArrowRight");
    expect(body()).toBe("x\ny");
    expect(selected(el)).toBe("1,1");
  });

  it("つまみで列の幅を変えるとファイルごとに覚え、2 度押すと戻す", async () => {
    const { el, store } = await table();
    const col = () => el.querySelectorAll<HTMLElement>("col")[1].style.width;
    const before = col();
    const grip = el.querySelector(".mg-csv-grip")!;
    act(() => {
      grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100 }));
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 250 }));
      window.dispatchEvent(new MouseEvent("mouseup", {}));
    });
    expect(col()).toBe(`${parseInt(before) + 150}px`);
    expect(store.get(csvWidthsAtom)["/本/表.csv"]).toEqual({ 0: parseInt(before) + 150 });
    act(() => {
      grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(col()).toBe(before);
    expect(store.get(csvWidthsAtom)["/本/表.csv"]).toBeUndefined();
  });
});

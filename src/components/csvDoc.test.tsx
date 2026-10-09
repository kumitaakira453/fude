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

// 見出しの ▽ から、列ごとに絞り込み・並べ替える（Excel のオートフィルタ）。
describe("列ごとの絞り込み", () => {
  const SALES = "名前,部署,金額\n佐藤,営業,1200\n鈴木,開発,300\n高橋,営業,45\n";
  const key = (el: Element, k: string) =>
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    });
  const table = async () => {
    content = SALES;
    const shown = await show();
    act(() => button(shown.el).click());
    return shown;
  };
  const names = (el: HTMLElement) =>
    [...el.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td")?.textContent);
  const numbers = (el: HTMLElement) =>
    [...el.querySelectorAll("tbody tr .mg-csv-no")].map((n) => n.getAttribute("data-n"));
  const funnel = (el: HTMLElement, col: number) =>
    el.querySelectorAll<HTMLButtonElement>(".mg-csv-funnel")[col];
  const pop = () => document.querySelector<HTMLElement>(".mg-csv-filter-pop");
  const row = (label: string) =>
    [...pop()!.querySelectorAll<HTMLButtonElement>(".mg-csv-filter-row, button")].find((b) =>
      b.textContent?.includes(label),
    )!;
  const bar = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>(".mg-imgdoc-bar button")].find(
      (b) => b.textContent === label,
    );

  it("値を外すとその行が消え、残った行は元の行番号のまま出る。帯に件数と解除が出る", async () => {
    const { el } = await table();
    act(() => funnel(el, 1).click());
    act(() => row("開発").click());
    expect(names(el)).toEqual(["佐藤", "高橋"]);
    expect(numbers(el)).toEqual(["2", "4"]);
    expect(funnel(el, 1).classList.contains("is-on")).toBe(true);
    expect(el.querySelector(".mg-imgdoc-bar")!.textContent).toContain("2 / 3 行");

    act(() => bar(el, "絞り込みを解除")!.click());
    expect(names(el)).toEqual(["佐藤", "鈴木", "高橋"]);
    expect(bar(el, "絞り込みを解除")).toBeUndefined();
  });

  it("見出しの入口は漏斗の印で、並べ替えた列は向きの矢印になる", async () => {
    const { el } = await table();
    const mark = (col: number) => funnel(el, col).querySelector("[data-icon]")!.getAttribute("data-icon");
    expect([mark(0), mark(1), mark(2)]).toEqual(["filter_list", "filter_list", "filter_list"]);
    act(() => funnel(el, 2).click());
    act(() => row("昇順").click());
    expect(mark(2)).toBe("arrow_upward");
    expect(funnel(el, 2).classList.contains("is-on")).toBe(true);
  });

  it("含む文字で絞り、数の列は数として並べ替える", async () => {
    const { el } = await table();
    act(() => funnel(el, 2).click());
    act(() => row("昇順").click());
    expect(names(el)).toEqual(["高橋", "鈴木", "佐藤"]);
    const input = pop()!.querySelector("input")!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "00");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(names(el)).toEqual(["鈴木", "佐藤"]);
  });

  it("矢印の上下は、残った行だけを辿る", async () => {
    const { el } = await table();
    act(() => funnel(el, 1).click());
    act(() => row("開発").click());
    act(() => {
      el.querySelector("tbody td")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const t = el.querySelector("table")!;
    key(t, "ArrowDown");
    expect(el.querySelector<HTMLElement>(".is-sel")!.dataset.r).toBe("3");
  });

  it("数の列だけに範囲の欄を出し、「以上」を打つとその場で絞る", async () => {
    const { el } = await table();
    act(() => funnel(el, 1).click());
    expect(pop()!.querySelector(".mg-csv-filter-range")).toBeNull();
    act(() => funnel(el, 2).click());
    const min = pop()!.querySelector<HTMLInputElement>('[aria-label="以上"]')!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(min, "300");
      min.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(names(el)).toEqual(["佐藤", "鈴木"]);
    // 値の一覧も範囲に入るものだけになる。
    expect(
      [...pop()!.querySelectorAll(".mg-csv-filter-value")].map((v) => v.textContent),
    ).toEqual(["300", "1200"]);
  });

  it("値が 1 つだけの列では「すべて」を出さない（その値と同じことを指す）", async () => {
    content = "名前,区分\n佐藤,A\n鈴木,A\n";
    const shown = await show();
    act(() => button(shown.el).click());
    act(() => funnel(shown.el, 1).click());
    expect(pop()!.querySelector(".is-all")).toBeNull();
    act(() => funnel(shown.el, 0).click());
    expect(pop()!.querySelector(".is-all")).not.toBeNull();
  });

  it("外を押すと小窓を閉じ、▽ をもう一度押しても閉じる", async () => {
    const { el } = await table();
    act(() => funnel(el, 0).click());
    expect(pop()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(pop()).toBeNull();
    act(() => funnel(el, 0).click());
    act(() => {
      funnel(el, 0).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      funnel(el, 0).click();
    });
    expect(pop()).toBeNull();
  });
});

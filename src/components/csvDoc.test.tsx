// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { csvViewAtom } from "../state/atoms";
import { CsvDoc } from "./CsvDoc";

// CSV は列ごとの色の原文で開き、釦で表に替わる。表では 1 行目をヘッダー行に置く。

vi.mock("../lib/fsAccess", () => ({
  readText: async () => '名前,点\n"山田, 太郎",90\n鈴木,80\n',
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

async function show() {
  const store = createStore();
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

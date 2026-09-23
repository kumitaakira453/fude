// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { wideTableAtom } from "../state/atoms";
import { Markdown } from "./Markdown";

// 幅の長い表の手当て。
//
// 溢れている表にだけ「大きく開く」を出す。収まっている表に釦を出しても押す
// 理由が無く、読んでいる間ずっと邪魔になる。

let root: Root | null = null;
let host: HTMLElement | null = null;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom は組版しないので、幅は自分で作る。包みと表に別々の幅を持たせて
// 「溢れている」状態を作る。
function widths(wrap: number, table: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("mg-table-wrap") ? wrap : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("mg-table-wrap") ? table : 0;
    },
  });
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const TABLE = ["| 店舗 | 4月 |", "| --- | --- |", "| 札幌 | 1,204 |"].join("\n");

function render(body: string, on = true): HTMLElement {
  const store = createStore();
  store.set(wideTableAtom, on);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <Provider store={store}>
        <Markdown body={body} editorial />
      </Provider>,
    );
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.querySelector(".mg-tablebox")?.remove();
  root = null;
  host = null;
});

const zoom = () => document.querySelector<HTMLElement>(".mg-table-zoom");

describe("幅の長い表", () => {
  it("溢れている表には「大きく開く」を出す", () => {
    widths(400, 900);
    render(TABLE);
    expect(zoom()).not.toBeNull();
  });

  it("収まっている表には出さない", () => {
    widths(900, 900);
    render(TABLE);
    expect(zoom()).toBeNull();
  });

  it("設定を切ったら出さない", () => {
    widths(400, 900);
    render(TABLE, false);
    expect(zoom()).toBeNull();
  });

  it("押すと小窓が開き、表を写して出す", () => {
    widths(400, 900);
    render(TABLE);
    act(() => zoom()!.click());
    const box = document.querySelector<HTMLElement>(".mg-tablebox");
    expect(box).not.toBeNull();
    expect(box!.querySelector("table")?.textContent).toContain("札幌");
    // 押せるものと編集の目印は写さない。
    expect(box!.querySelector("[data-mg-cell]")).toBeNull();
    expect(box!.querySelector(".mg-table-zoom")).toBeNull();
  });

  it("縮小に入れ替わる", () => {
    widths(400, 900);
    render(TABLE);
    act(() => zoom()!.click());
    const act1 = document.querySelector<HTMLElement>(".mg-tablebox-act")!;
    expect(act1.textContent).toContain("縮小");
    act(() => act1.click());
    const body = document.querySelector(".mg-tablebox-body")!;
    expect(body.classList.contains("is-tight")).toBe(true);
    expect(
      document.querySelector<HTMLElement>(".mg-tablebox-act")!.textContent,
    ).toContain("等倍");
  });

  it("Esc で閉じる", () => {
    widths(400, 900);
    render(TABLE);
    act(() => zoom()!.click());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.querySelector(".mg-tablebox")).toBeNull();
  });
});

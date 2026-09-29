// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { folderIconsAtom } from "../state/atoms";
import { FileIcon } from "./FileIcon";
import { FolderIconPicker, pickerPlace } from "./FolderIconPicker";

// フォルダのアイコンを選ぶ盤。選ぶと付いて閉じ、「元に戻す」で外れる。
// 付いたフォルダの顔は、名前から決まる線画ではなく選んだアイコンになる。

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

const AT = { x: 10, y: 10, left: 0, abs: "/本/資料", name: "資料" };

function show(initial: Record<string, string> = {}) {
  const store = createStore();
  store.set(folderIconsAtom, initial);
  const closed: number[] = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <FolderIconPicker at={AT} onClose={() => closed.push(1)} />
        <FileIcon name="資料" abs="/本/資料" dir />
      </Provider>,
    ),
  );
  return { store, closed };
}

const cells = () => [...document.querySelectorAll<HTMLButtonElement>(".mg-ficon-pick-cell")];
const type = (text: string) =>
  act(() => {
    const input = document.querySelector<HTMLInputElement>(".mg-ficon-pick-search")!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("フォルダのアイコンを選ぶ盤", () => {
  it("英語の名前で絞り、押すとそのフォルダに付いて閉じる", () => {
    const { store, closed } = show();
    expect(document.querySelector("svg.mg-ficon")).not.toBeNull();
    type("sports bar");
    const hit = cells().find((c) => c.getAttribute("aria-label") === "sports_bar")!;
    expect(cells().every((c) => c.getAttribute("aria-label")!.includes("sports_bar"))).toBe(true);
    act(() => hit.click());
    expect(store.get(folderIconsAtom)).toEqual({ "/本/資料": "sports_bar" });
    expect(closed).toHaveLength(1);
    // 顔は選んだアイコンになる（線画の svg ではなく字形）。
    const face = document.querySelector(".mg-ficon-sym")!;
    expect(face.textContent).toBe("sports_bar");
    expect(document.querySelector("svg.mg-ficon")).toBeNull();
  });

  it("一致が無ければそう出す", () => {
    show();
    type("zzzzqqq");
    expect(cells()).toHaveLength(0);
    expect(document.querySelector(".mg-ficon-pick-none")!.textContent).toContain("ありません");
  });

  it("付いているものは印し、「元に戻す」で外す", () => {
    const { store, closed } = show({ "/本/資料": "book", "/本/他": "star" });
    type("book");
    expect(cells().find((c) => c.getAttribute("aria-label") === "book")!.className).toContain("is-on");
    const reset = [...document.querySelectorAll("button")].find((b) => b.textContent === "元に戻す")!;
    act(() => reset.click());
    expect(store.get(folderIconsAtom)).toEqual({ "/本/他": "star" });
    expect(closed).toHaveLength(1);
  });
});

describe("盤の位置", () => {
  const view = { width: 1200, height: 800 };

  it("メニューの右隣、押した項目の高さに出す", () => {
    expect(pickerPlace({ x: 420, y: 120, left: 200 }, view)).toEqual({ left: 420, top: 120 });
  });

  it("右にはみ出すときはメニューの左に、下にはみ出すときは上へずらす", () => {
    // 盤の幅は 392、高さは 420。
    expect(pickerPlace({ x: 1000, y: 600, left: 780 }, view)).toEqual({ left: 388, top: 372 });
  });
});

describe("メニューとの関わり", () => {
  it("メニューの中を押しても閉じず、外を押すと閉じる", () => {
    const { closed } = show();
    const menu = document.createElement("div");
    menu.setAttribute("data-entry-menu", "");
    const item = document.createElement("button");
    menu.appendChild(item);
    document.body.appendChild(menu);
    act(() => {
      item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(closed).toHaveLength(0);
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(closed).toHaveLength(1);
    menu.remove();
  });

  it("盤の中の click は窓まで伝えない（メニューが外を押したと受け取らない）", () => {
    show();
    let reached = 0;
    const count = () => reached++;
    window.addEventListener("click", count);
    act(() => {
      document.querySelector<HTMLInputElement>(".mg-ficon-pick-search")!.click();
    });
    window.removeEventListener("click", count);
    expect(reached).toBe(0);
  });
});

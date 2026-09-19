// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MenuButton, type MenuItem } from "./MenuButton";

// 釦の足元に出す小さな一覧。
//
// 見たいのは、開いたあと確実に閉じられること。押しっぱなしの板が残ると、
// その下の操作が全部届かなくなる。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let ran: string[] = [];

function show(items: MenuItem[]) {
  ran = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(<MenuButton icon="more_horiz" title="そのほか" items={items} />),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
});

const open = () => document.querySelector<HTMLElement>('[aria-haspopup="menu"]')!;
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
// 絵の名前が textContent に混ざるので、行の名前だけを見る。
const labels = () =>
  rows().map((el) => el.querySelector("span.flex-1")?.textContent ?? "");
const pop = () => document.querySelector(".mg-menu-pop");
const click = (el: HTMLElement) => act(() => el.click());

const item = (label: string, over: Partial<MenuItem> = {}): MenuItem => ({
  icon: "check",
  label,
  run: () => ran.push(label),
  ...over,
});

describe("MenuButton", () => {
  it("押すと中身が出る", () => {
    show([item("ひとつ"), item("ふたつ")]);
    expect(pop()).toBeNull();
    click(open());
    expect(labels()).toEqual(["ひとつ", "ふたつ"]);
  });

  it("選ぶとその行が走り、一覧は閉じる", () => {
    show([item("ひとつ"), item("ふたつ")]);
    click(open());
    click(rows()[1]);
    expect(ran).toEqual(["ふたつ"]);
    expect(pop()).toBeNull();
  });

  it("もう一度押すと閉じる", () => {
    show([item("ひとつ")]);
    click(open());
    click(open());
    expect(pop()).toBeNull();
  });

  it("外を押すと閉じる", () => {
    show([item("ひとつ")]);
    click(open());
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(pop()).toBeNull();
  });

  it("Esc で閉じる", () => {
    show([item("ひとつ")]);
    click(open());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(pop()).toBeNull();
  });

  it("いまそれである行と、選べない行がそれと分かる", () => {
    show([
      item("いま", { on: true }),
      item("だめ", { disabled: true, why: "いまは選べません" }),
    ]);
    click(open());
    expect(rows()[0].classList.contains("is-on")).toBe(true);
    expect(rows()[1].hasAttribute("disabled")).toBe(true);
    expect(rows()[1].title).toBe("いまは選べません");
  });

  it("選べない行は走らせない", () => {
    show([item("だめ", { disabled: true })]);
    click(open());
    click(rows()[0]);
    expect(ran).toEqual([]);
  });
});

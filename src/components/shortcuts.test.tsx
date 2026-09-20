// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { shortcutsOpenAtom } from "../state/atoms";
import { Shortcuts } from "./Shortcuts";

// キー操作の一覧。場面で分ける。
//
// 同じキーが場面で別のものを指すことがある（⌘I は読むときのコメントで、
// 書いている最中は斜体）ので、混ぜると読み違える。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let store: ReturnType<typeof createStore>;

function open() {
  store = createStore();
  store.set(shortcutsOpenAtom, true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Shortcuts />
      </Provider>,
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
});

const box = () => document.querySelector<HTMLElement>(".mg-keys")!;
const keys = () =>
  Array.from(box().querySelectorAll("kbd")).map((el) => el.textContent ?? "");
const titles = () =>
  Array.from(box().querySelectorAll("h3")).map((el) => el.textContent ?? "");
const tab = (label: string) =>
  Array.from(box().querySelectorAll<HTMLElement>(".mg-set-tab")).find((el) =>
    el.textContent?.includes(label),
  )!;
const click = (el: HTMLElement) => act(() => el.click());
const press = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  });

describe("場面で分ける", () => {
  it("はじめは開く・移動の面", () => {
    open();
    expect(titles()).toEqual(["開く・行き来する"]);
    expect(keys()).toContain("⌘O");
  });

  it("面を変えると中身が入れ替わる", () => {
    open();
    click(tab("書く"));
    expect(keys()).toContain("⌘B");
    expect(keys()).not.toContain("⌘O");
  });

  it("読む面に、右の欄のキーを出す", () => {
    open();
    click(tab("読む"));
    expect(keys()).toContain("⌘⇧O");
    expect(keys()).toContain("⌘⇧K");
  });

  it("行の少ない組は、そのほかにまとめる", () => {
    open();
    click(tab("そのほか"));
    expect(titles()).toEqual([
      "画像・HTML を見る",
      "メタ情報の小窓（⌘⇧M）",
      "つまみ（本文の左に出る）",
      "そのほか",
    ]);
  });

  it("開き直すと先頭の面へ戻る", () => {
    open();
    click(tab("書く"));
    act(() => store.set(shortcutsOpenAtom, false));
    act(() => store.set(shortcutsOpenAtom, true));
    expect(titles()).toEqual(["開く・行き来する"]);
  });

  it("上下で面を移る（端はひと回りする）", () => {
    open();
    press("ArrowDown");
    expect(titles()).toEqual(["読む"]);
    press("ArrowUp");
    expect(titles()).toEqual(["開く・行き来する"]);
    // 先頭でさらに上へ押すと、最後の面へ回る。
    press("ArrowUp");
    expect(titles()).toContain("つまみ（本文の左に出る）");
  });

  it("Esc で閉じる", () => {
    open();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(store.get(shortcutsOpenAtom)).toBe(false);
  });
});

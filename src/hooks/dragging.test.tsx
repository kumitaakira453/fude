// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useDragging } from "./useDragging";

// 選択を引いているあいだ、本文に重ねたものを触れない板にする印。
//
// この印は押し下げの番に付くので、押した先が「触れない板になるもの」だと、
// 続く mouseup と click がそこへ届かなくなる。帯のボタンがそれで、押しても
// 何も起きない状態になっていた（種別のメニューは click で出すため）。
// 当たり判定を持たない jsdom では見た目に出ないので、印が付くかどうかで見る。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function Watch() {
  useDragging();
  return null;
}

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Watch />));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.classList.remove("mg-dragging");
  document.querySelectorAll(".probe").forEach((el) => el.remove());
  root = null;
  host = null;
});

// 押し下げの相手を作って押す。
function pressIn(className: string): void {
  const box = document.createElement("div");
  box.className = `probe ${className}`;
  const button = document.createElement("button");
  box.appendChild(button);
  document.body.appendChild(box);
  mount();
  button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
}

const marked = () => document.body.classList.contains("mg-dragging");

describe("引いている印", () => {
  it("本文を押したら付く", () => {
    pressIn("mg-body");
    expect(marked()).toBe(true);
  });

  const spared = [
    ["選択メニュー", "mg-sel-menu"],
    ["ブロックのメニュー", "mg-block-menu"],
    ["ブロックのつまみ", "mg-block-layer"],
    ["指摘の層", "mg-review-layer"],
    ["絞り込みの層", "mg-hl-layer"],
    ["聞く小窓", "mg-ask"],
  ];
  for (const [name, className] of spared) {
    it(`${name}を押したら付かない`, () => {
      pressIn(className);
      expect(marked()).toBe(false);
    });
  }

  it("離したら外れる", () => {
    pressIn("mg-body");
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(marked()).toBe(false);
  });
});

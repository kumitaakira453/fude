// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCarry } from "./carry";

// マウスで運ぶ仕組み。押しただけならメニューを出す道を残し、動かしたら写しが
// カーソルに付き、離した番でその場で終わる（戻るアニメーションは無い）。

const ghostOf = () => {
  const el = document.createElement("div");
  el.dataset.ghost = "1";
  return el;
};
const carried = () => document.querySelector("[data-ghost]");

function press(ghost: HTMLElement | null = ghostOf()) {
  const seen = { move: [] as number[][], drop: 0, cancel: 0, start: 0 };
  const stop = startCarry({
    from: { x: 100, y: 100 },
    ghost,
    grip: { x: 5, y: 5 },
    onStart: () => seen.start++,
    onMove: (x, y) => seen.move.push([x, y]),
    onDrop: () => seen.drop++,
    onCancel: () => seen.cancel++,
  });
  return { seen, stop };
}

const move = (x: number, y: number) =>
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y }));
const up = (x = 0, y = 0) =>
  window.dispatchEvent(new MouseEvent("mouseup", { clientX: x, clientY: y }));

afterEach(() => {
  document.body.className = "";
  for (const el of document.querySelectorAll("[data-ghost]")) el.remove();
  vi.restoreAllMocks();
});

// 写しの置き場所は 1 フレームにまとめてある。試験では即座に走らせる。
const paint = () =>
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => {
    f(0);
    return 0;
  });

describe("マウスで運ぶ", () => {
  it("数 px 動くまで始まらない", () => {
    const { seen } = press();
    move(102, 101);
    expect(seen.start).toBe(0);
    expect(seen.move.length).toBe(0);
    expect(carried()).toBeNull();
    up();
    // 運びが始まっていないので、離しても落としたことにしない。
    expect(seen.drop).toBe(0);
  });

  it("動かすと写しが付き、カーソルを追う", () => {
    paint();
    const { seen } = press();
    move(140, 160);
    expect(seen.start).toBe(1);
    expect(seen.move).toEqual([[140, 160]]);
    const el = carried() as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.classList.contains("mg-carry")).toBe(true);
    // 掴んだ点のぶんだけずらして置く。
    expect(el.style.left).toBe("135px");
    expect(el.style.top).toBe("155px");
    expect(document.body.classList.contains("mg-carrying")).toBe(true);
    move(200, 240);
    expect(el.style.left).toBe("195px");
  });

  it("離すとその番で終わり、写しが消える", () => {
    paint();
    const { seen } = press();
    move(140, 160);
    up(140, 160);
    expect(seen.drop).toBe(1);
    // 離した同じ番で消えている（戻るアニメーションを挟まない）。
    expect(carried()).toBeNull();
    expect(document.body.classList.contains("mg-carrying")).toBe(false);
  });

  it("Escape でやめる", () => {
    paint();
    const { seen } = press();
    move(140, 160);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(seen.cancel).toBe(1);
    expect(seen.drop).toBe(0);
    expect(carried()).toBeNull();
  });

  it("窓が焦点を失ったらやめる", () => {
    paint();
    const { seen } = press();
    move(140, 160);
    window.dispatchEvent(new Event("blur"));
    expect(seen.cancel).toBe(1);
    expect(carried()).toBeNull();
  });

  it("途中でやめる口を呼んでもやめる", () => {
    paint();
    const { seen, stop } = press();
    move(140, 160);
    stop();
    expect(seen.cancel).toBe(1);
    expect(carried()).toBeNull();
  });

  it("片付けたあとは聞き耳が残らない", () => {
    paint();
    const { seen } = press();
    move(140, 160);
    up();
    move(300, 300);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(seen.move.length).toBe(1);
    expect(seen.cancel).toBe(0);
  });

  it("写しが無くても運べる", () => {
    const { seen } = press(null);
    move(140, 160);
    expect(seen.start).toBe(1);
    expect(carried()).toBeNull();
    up();
    expect(seen.drop).toBe(1);
  });
});

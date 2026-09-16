// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchDragScroll } from "./dragScroll";

// 端へ寄ったときに面を送るか。jsdom は描画を持たないので、面の箱と
// 「どれだけ送れるか」は当て木で置き、見るのは送る向きと譲り方。

// 掴んでいる間に回るフレーム。手で 1 枚ずつ進める。
let frames: FrameRequestCallback[] = [];

// 面を組む。box は画面の中での位置、full は中身の高さ。
function surface(
  box: { top: number; left: number; width: number; height: number },
  full: { height: number; width?: number },
  how: { y?: string; x?: string } = { y: "auto" },
): HTMLElement {
  const el = document.createElement("div");
  el.style.overflowY = how.y ?? "visible";
  el.style.overflowX = how.x ?? "visible";
  el.getBoundingClientRect = () =>
    new DOMRect(box.left, box.top, box.width, box.height);
  Object.defineProperties(el, {
    clientHeight: { value: box.height, configurable: true },
    clientWidth: { value: box.width, configurable: true },
    scrollHeight: { value: full.height, configurable: true },
    scrollWidth: { value: full.width ?? box.width, configurable: true },
  });
  return el;
}

const hover = (el: Element | null) => {
  document.elementFromPoint = () => el;
};

const drag = (x: number, y: number) => {
  const e = new Event("dragover", { bubbles: true }) as DragEvent;
  Object.defineProperties(e, {
    clientX: { value: x },
    clientY: { value: y },
  });
  window.dispatchEvent(e);
};

const tick = () => {
  const run = frames;
  frames = [];
  for (const f of run) f(0);
};

let stop: () => void;

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    frames.push(f);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  stop = watchDragScroll();
});

afterEach(() => {
  stop();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("掴んだままの送り", () => {
  it("上端に寄せると戻る方へ送る", () => {
    const el = surface({ top: 0, left: 0, width: 400, height: 600 }, { height: 3000 });
    el.scrollTop = 1000;
    document.body.appendChild(el);
    hover(el);

    drag(200, 10);
    tick();
    expect(el.scrollTop).toBeLessThan(1000);
  });

  it("下端に寄せると進む方へ送る", () => {
    const el = surface({ top: 0, left: 0, width: 400, height: 600 }, { height: 3000 });
    el.scrollTop = 1000;
    document.body.appendChild(el);
    hover(el);

    drag(200, 590);
    tick();
    expect(el.scrollTop).toBeGreaterThan(1000);
  });

  it("端に近いほど速く送る", () => {
    const el = surface({ top: 0, left: 0, width: 400, height: 600 }, { height: 3000 });
    document.body.appendChild(el);
    hover(el);

    el.scrollTop = 1000;
    drag(200, 550); // 端から 50px
    tick();
    const slow = el.scrollTop - 1000;

    el.scrollTop = 1000;
    drag(200, 599); // 端から 1px
    tick();
    expect(el.scrollTop - 1000).toBeGreaterThan(slow);
  });

  it("端から離れていれば動かさない", () => {
    const el = surface({ top: 0, left: 0, width: 400, height: 600 }, { height: 3000 });
    el.scrollTop = 1000;
    document.body.appendChild(el);
    hover(el);

    drag(200, 300);
    tick();
    expect(el.scrollTop).toBe(1000);
  });

  it("送る余地が無い面は飛ばして、外側の面を送る", () => {
    // 本文の中の表（もう上へは送れない）の上で、本文そのものを送る。
    const outer = surface({ top: 0, left: 0, width: 400, height: 600 }, { height: 3000 });
    outer.scrollTop = 800;
    const inner = surface(
      { top: 0, left: 0, width: 400, height: 200 },
      { height: 600 },
      { y: "auto" },
    );
    inner.scrollTop = 0; // 上には余地が無い
    outer.appendChild(inner);
    document.body.appendChild(outer);
    hover(inner);

    drag(200, 10);
    tick();
    expect(inner.scrollTop).toBe(0);
    expect(outer.scrollTop).toBeLessThan(800);
  });

  it("送らない面は素通りする", () => {
    const outer = surface({ top: 0, left: 0, width: 400, height: 600 }, { height: 3000 });
    outer.scrollTop = 800;
    const inner = surface(
      { top: 0, left: 0, width: 400, height: 200 },
      { height: 600 },
      { y: "hidden" },
    );
    outer.appendChild(inner);
    document.body.appendChild(outer);
    hover(inner);

    drag(200, 10);
    tick();
    expect(inner.scrollTop).toBe(0);
    expect(outer.scrollTop).toBeLessThan(800);
  });

  it("横に送る面は、左右の端で送る", () => {
    const el = surface(
      { top: 0, left: 0, width: 400, height: 600 },
      { height: 600, width: 2000 },
      { x: "auto" },
    );
    el.scrollLeft = 500;
    document.body.appendChild(el);
    hover(el);

    drag(395, 300);
    tick();
    expect(el.scrollLeft).toBeGreaterThan(500);
  });

  it("離したあとは、フレームが来ても動かさない", () => {
    const el = surface({ top: 0, left: 0, width: 400, height: 600 }, { height: 3000 });
    el.scrollTop = 1000;
    document.body.appendChild(el);
    hover(el);

    drag(200, 10);
    window.dispatchEvent(new Event("dragend", { bubbles: true }));
    tick();
    expect(el.scrollTop).toBe(1000);
  });

  it("見張りをやめたら、掴んでも動かさない", () => {
    const el = surface({ top: 0, left: 0, width: 400, height: 600 }, { height: 3000 });
    el.scrollTop = 1000;
    document.body.appendChild(el);
    hover(el);

    stop();
    drag(200, 10);
    tick();
    expect(el.scrollTop).toBe(1000);
  });
});

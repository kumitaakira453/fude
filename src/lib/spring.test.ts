// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSpring, watchSpringDetails } from "./spring";

// 掴んだまま留まったら開く。留まる長さと、指す先が変わったときの数え直しを見る。

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("留まったら開く", () => {
  it("同じものを指したまま時が経てば開く", () => {
    const opened: string[] = [];
    const spring = makeSpring<string>((k) => opened.push(k), 500);
    spring.over("資料");
    vi.advanceTimersByTime(499);
    expect(opened).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(opened).toEqual(["資料"]);
  });

  it("通り過ぎるだけでは開かない", () => {
    const opened: string[] = [];
    const spring = makeSpring<string>((k) => opened.push(k), 500);
    spring.over("資料");
    vi.advanceTimersByTime(300);
    spring.over("図");
    vi.advanceTimersByTime(300);
    expect(opened).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(opened).toEqual(["図"]);
  });

  it("外れたら数えるのをやめる", () => {
    const opened: string[] = [];
    const spring = makeSpring<string>((k) => opened.push(k), 500);
    spring.over("資料");
    spring.over(null);
    vi.advanceTimersByTime(1000);
    expect(opened).toEqual([]);
  });

  it("同じものを指し続けても、数え直さない", () => {
    const opened: string[] = [];
    const spring = makeSpring<string>((k) => opened.push(k), 500);
    spring.over("資料");
    vi.advanceTimersByTime(400);
    spring.over("資料");
    vi.advanceTimersByTime(100);
    expect(opened).toEqual(["資料"]);
  });
});

describe("編集面の畳んだトグル", () => {
  function put(): { mark: HTMLElement; pressed: string[] } {
    const box = document.createElement("div");
    box.className = "mg-details is-closed";
    const mark = document.createElement("button");
    mark.className = "mg-details-mark";
    box.appendChild(mark);
    document.body.appendChild(box);
    const pressed: string[] = [];
    mark.addEventListener("mousedown", () => pressed.push("開く"));
    document.elementFromPoint = () => mark;
    return { mark, pressed };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("畳んだトグルの上に留まったら、三角を押したのと同じになる", () => {
    const { pressed } = put();
    const stop = watchSpringDetails();
    window.dispatchEvent(
      new MouseEvent("dragover", { clientX: 10, clientY: 10 }),
    );
    vi.advanceTimersByTime(1000);
    expect(pressed).toEqual(["開く"]);
    stop();
  });

  it("離したら開かない", () => {
    const { pressed } = put();
    const stop = watchSpringDetails();
    window.dispatchEvent(
      new MouseEvent("dragover", { clientX: 10, clientY: 10 }),
    );
    window.dispatchEvent(new Event("drop"));
    vi.advanceTimersByTime(1000);
    expect(pressed).toEqual([]);
    stop();
  });
});

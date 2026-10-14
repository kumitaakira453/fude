// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FilterChip } from "./CommentRail";

// コメントの欄の絞り込み。札を押すと選択肢の一覧が開く。
//
// 右の欄は外を切っているので、一覧は欄の外（body）へ出し、札が欄のどこに
// あっても窓の中に収める。

const WIDTH = 216;
const HEIGHT = 180;
const EDGE = 8;

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
  vi.restoreAllMocks();
});

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;

// 札の左端を chipLeft に置いて開く。窓は 1000 × 700。
async function openAt(chipLeft: number, onPick = vi.fn()) {
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("mg-rail-filter")) return rect(chipLeft, 40, 70, 22);
    if (this.classList.contains("mg-rail-menu")) return rect(0, 0, WIDTH, HEIGHT);
    return rect(0, 0, 0, 0);
  });
  host = document.createElement("div");
  host.className = "mg-rail";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <FilterChip now="todo" counts={{ todo: 2, open: 2, done: 9, all: 11 }} onPick={onPick} />,
    );
  });
  await act(async () => host!.querySelector<HTMLButtonElement>(".mg-rail-chip")!.click());
  const menu = document.querySelector<HTMLElement>(".mg-rail-menu")!;
  return { menu, left: parseFloat(menu.style.left), top: parseFloat(menu.style.top) };
}

describe("絞り込みの一覧", () => {
  it("欄の外（body の直下）に出す", async () => {
    const { menu } = await openAt(800);
    expect(host!.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
  });

  it("札の右端にそろえ、札の下に出す", async () => {
    const { left, top } = await openAt(600);
    expect(left + WIDTH).toBe(670);
    expect(top).toBeGreaterThan(62);
  });

  it("札が窓の左端寄りでも、左が切れない", async () => {
    const { left } = await openAt(20);
    expect(left).toBeGreaterThanOrEqual(EDGE);
  });

  it("札が窓の右端寄りでも、右が切れない", async () => {
    const { left } = await openAt(960);
    expect(left + WIDTH).toBeLessThanOrEqual(1000 - EDGE);
  });

  it("選ぶと渡して閉じる", async () => {
    const onPick = vi.fn();
    const { menu } = await openAt(600, onPick);
    const done = [...menu.querySelectorAll("button")].find((b) => b.textContent?.includes("解決済み"));
    await act(async () => done!.click());
    expect(onPick).toHaveBeenCalledWith("done");
    expect(document.querySelector(".mg-rail-menu")).toBeNull();
  });

  it("一覧の中を押しても閉じず、外を押すと閉じる", async () => {
    const { menu } = await openAt(600);
    await act(async () => {
      menu.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector(".mg-rail-menu")).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector(".mg-rail-menu")).toBeNull();
  });
});

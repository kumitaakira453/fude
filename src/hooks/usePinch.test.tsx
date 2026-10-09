// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { usePinch } from "./usePinch";

// WebKit のピンチ（gesturestart / gesturechange）。jsdom には無い催しなので、
// 同じ名前の Event に scale と指の位置を載せて投げる。

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

const said: string[] = [];

function Pad() {
  const ref = useRef<HTMLDivElement>(null);
  usePinch(ref, {
    start: () => said.push("start"),
    change: (ratio, at) => said.push(`${ratio}@${at.x},${at.y}`),
  });
  return <div ref={ref} data-pad />;
}

function gesture(el: Element, name: string, scale: number, x: number, y: number) {
  const e = new Event(name, { bubbles: true, cancelable: true });
  Object.assign(e, { scale, clientX: x, clientY: y });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

describe("ピンチ", () => {
  it("始まりを知らせ、始まりからの比と枠の中の指の位置を渡す。窓ごとの拡大は止める", () => {
    said.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<Pad />));
    const pad = host.querySelector<HTMLElement>("[data-pad]")!;
    pad.getBoundingClientRect = () => ({ left: 100, top: 50 }) as DOMRect;

    const start = gesture(pad, "gesturestart", 1, 0, 0);
    const change = gesture(pad, "gesturechange", 1.5, 160, 90);
    expect(said).toEqual(["start", "1.5@60,40"]);
    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);
  });
});

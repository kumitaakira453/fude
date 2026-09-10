// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_WIDTH } from "../lib/sidebar";
import { SidebarGrip } from "./SidebarGrip";

// 左の欄の仕切り。掴んで動かした分だけ幅が変わる。
//
// jsdom に PointerEvent は無いので、MouseEvent を pointerdown / pointermove /
// pointerup の名前で投げる（受け側が読むのは clientX だけ）。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
// 呼ばれた幅を順に受ける。最後のものが今の幅。
let asked: number[] = [];

function mount(width: number) {
  asked = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <SidebarGrip width={width} onWidth={(w) => asked.push(w)} />,
    ),
  );
  return host.querySelector<HTMLElement>(".mg-side-grip")!;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

const at = (name: string, x: number, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(
      new MouseEvent(name, { bubbles: true, clientX: x, button: 0 }),
    );
  });

const last = () => asked[asked.length - 1];

describe("左の欄の仕切り", () => {
  it("掴んで動かした分だけ幅が変わる", () => {
    const grip = mount(300);
    at("pointerdown", 300, grip);
    at("pointermove", 380);
    expect(last()).toBe(380);
    at("pointermove", 260);
    expect(last()).toBe(260);
  });

  it("掴んでいるあいだは矢印を変え、字を選ばせない", () => {
    const grip = mount(300);
    at("pointerdown", 300, grip);
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
    at("pointerup", 300);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("下限より狭くならない", () => {
    const grip = mount(SIDEBAR_MIN + 20);
    at("pointerdown", 500, grip);
    at("pointermove", 0);
    expect(last()).toBe(SIDEBAR_MIN);
  });

  it("上限より広くならない", () => {
    const grip = mount(SIDEBAR_MAX - 20);
    at("pointerdown", 500, grip);
    at("pointermove", 5000);
    expect(last()).toBe(SIDEBAR_MAX);
  });

  it("離した後に動かしても変わらない", () => {
    const grip = mount(300);
    at("pointerdown", 300, grip);
    at("pointermove", 380);
    at("pointerup", 380);
    const before = asked.length;
    at("pointermove", 600);
    expect(asked.length).toBe(before);
  });

  it("ダブルクリックで元の幅に戻る", () => {
    const grip = mount(600);
    act(() => {
      grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(last()).toBe(SIDEBAR_WIDTH);
  });
});

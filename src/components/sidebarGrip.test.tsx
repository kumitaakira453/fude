// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_WIDTH } from "../lib/sidebar";
import { SidebarGrip } from "./SidebarGrip";

// 左の欄の仕切り。掴んで動かした分だけ幅が変わる。
//
// 掴んでいるあいだは入れ物へ直に書き、控えへ入れるのは離した 1 回だけ
// （動かした一枚ごとに状態を通すと、木全体が描き直されて手に付いてこない）。
//
// jsdom に PointerEvent は無いので、MouseEvent を pointerdown / pointermove /
// pointerup の名前で投げる（受け側が読むのは clientX だけ）。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
// 控えへ入れられた幅を順に受ける。
let asked: number[] = [];
// 幅を当てる入れ物。
let box: HTMLDivElement | null = null;

function mount(width: number) {
  asked = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  box = document.createElement("div");
  box.style.width = `${width}px`;
  document.body.appendChild(box);
  const target: React.RefObject<HTMLElement | null> = { current: box };
  root = createRoot(host);
  act(() =>
    root!.render(
      <SidebarGrip
        target={target}
        width={width}
        onWidth={(w) => asked.push(w)}
      />,
    ),
  );
  return host.querySelector<HTMLElement>(".mg-side-grip")!;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  box?.remove();
  root = null;
  host = null;
  box = null;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

const at = (name: string, x: number, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(
      new MouseEvent(name, { bubbles: true, clientX: x, button: 0 }),
    );
  });

const shown = () => box!.style.width;
const last = () => asked[asked.length - 1];

describe("左の欄の仕切り", () => {
  it("掴んで動かすと、入れ物の幅がその場で変わる", () => {
    const grip = mount(300);
    at("pointerdown", 300, grip);
    at("pointermove", 380);
    expect(shown()).toBe("380px");
    at("pointermove", 260);
    expect(shown()).toBe("260px");
    // 動かしているあいだは控えへ入れない
    expect(asked).toEqual([]);
  });

  it("離したときに控えへ入れる", () => {
    const grip = mount(300);
    at("pointerdown", 300, grip);
    at("pointermove", 380);
    at("pointerup", 380);
    expect(asked).toEqual([380]);
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
    expect(shown()).toBe(`${SIDEBAR_MIN}px`);
  });

  it("上限より広くならない", () => {
    const grip = mount(SIDEBAR_MAX - 20);
    at("pointerdown", 500, grip);
    at("pointermove", 5000);
    expect(shown()).toBe(`${SIDEBAR_MAX}px`);
  });

  it("離した後に動かしても変わらない", () => {
    const grip = mount(300);
    at("pointerdown", 300, grip);
    at("pointermove", 380);
    at("pointerup", 380);
    at("pointermove", 600);
    expect(shown()).toBe("380px");
    expect(asked).toEqual([380]);
  });

  it("掴んだまま消えても、張った分を外す", () => {
    const grip = mount(300);
    at("pointerdown", 300, grip);
    act(() => root?.unmount());
    root = null;
    expect(document.body.style.cursor).toBe("");
    at("pointermove", 600);
    expect(shown()).toBe("300px");
  });

  it("ダブルクリックで元の幅に戻る", () => {
    const grip = mount(600);
    act(() => {
      grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(last()).toBe(SIDEBAR_WIDTH);
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BodyEditor } from "./BodyEditor";

// 組んだ数式を押して中身を打ち直す。
//
// 押下の入口は NodeView、位置はプラグイン、入力欄は React の側にある。
// つながっていないと「押しても何も出ない」になるので、通しで見る。

const BODY = "文中の $a^2 + b^2$ と続く。\n\n$$\n\\int_0^1 x\\,dx\n$$\n";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const noRects = () => [] as unknown as DOMRectList;
  const noRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = noRects;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = noRect;
  if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => [];
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

let root: Root | null = null;
let host: HTMLElement | null = null;
const wrote: string[] = [];
const flush: { current: (() => void) | null } = { current: null };

function editor(body = BODY) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <BodyEditor
        body={body}
        prefix=""
        dark={false}
        className="mg-prose prose"
        onChange={(next) => wrote.push(next)}
        onSave={() => {}}
        flushRef={flush}
      />,
    ),
  );
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll(".mg-ask").forEach((el) => el.remove());
  wrote.length = 0;
  root = null;
  host = null;
});

const box = () => document.querySelector(".mg-ask");
const field = () =>
  document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
    ".mg-ask textarea, .mg-ask input",
  );

// 押すのは click。押し下げで出すと、入力欄が付ける「外を押したら閉じる」が
// まだ配り終えていないその押下を受け取って端から閉じる。
function press(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
}

const nativeValue = (el: HTMLElement) =>
  Object.getOwnPropertyDescriptor(
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    "value",
  )!.set!;

// 打ち込みだけ（決めない）。
function type(text: string) {
  const el = field()!;
  act(() => {
    nativeValue(el).call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function fill(text: string, opts: { meta?: boolean } = {}) {
  const el = field()!;
  type(text);
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: opts.meta ?? false,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

const saved = (): string => {
  act(() => flush.current?.());
  return wrote.at(-1) ?? "";
};

describe("組んだ数式を押して打ち直す", () => {
  it("行内の式は一行で聞き、Enter で決まる", () => {
    const at = editor();
    expect(box()).toBeNull();
    press(at.querySelector(".mg-math")!);
    expect(field()?.tagName).toBe("INPUT");
    expect(field()?.value).toBe("a^2 + b^2");
    fill("c^2");
    expect(box()).toBeNull();
    expect(saved()).toContain("文中の $c^2$ と続く。");
  });

  it("独立した式は複数行で聞き、⌘Enter で決まる", () => {
    const at = editor();
    press(at.querySelector(".mg-math-block")!);
    expect(field()?.tagName).toBe("TEXTAREA");
    expect(field()?.value).toBe("\\int_0^1 x\\,dx");
    // 改行は本文なので、素の Enter では決まらない。
    fill("a\nb");
    expect(box()).not.toBeNull();
    fill("a\nb", { meta: true });
    expect(box()).toBeNull();
    expect(saved()).toContain("$$\na\nb\n$$");
  });

  it("打っているそばから組み直す", () => {
    const at = editor();
    const block = () => at.querySelector<HTMLElement>(".mg-math-block")!;
    press(block());
    // 決める前でも、打った分が節点へ入って組み直される。
    type("x + 1");
    expect(block().getAttribute("data-tex")).toBe("x + 1");
    expect(box()).not.toBeNull();
  });

  it("中身を空にして決めると、式ごと消える", () => {
    const at = editor();
    press(at.querySelector(".mg-math-block")!);
    fill("", { meta: true });
    expect(at.querySelector(".mg-math-block")).toBeNull();
    expect(saved()).not.toContain("$$");
  });
});

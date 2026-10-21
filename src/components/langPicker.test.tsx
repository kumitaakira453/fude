// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BodyEditor } from "./BodyEditor";

// 編集面のコードの塊の言語の一覧。開いた直後は今の言語の行を選んでおく。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom は描画を持たないので、測る道具だけ足しておく。
  Element.prototype.scrollIntoView = () => {};
  // 測れない場の代わりに、空の矩形の並びと 0 の矩形を返す。
  const noRects = () => document.createElement("div").getClientRects();
  const noRect = () => new DOMRect(0, 0, 0, 0);
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = noRect;
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll(".mg-lang-menu").forEach((el) => el.remove());
  root = null;
  host = null;
});

function editor(body: string): HTMLElement {
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
        onChange={() => {}}
        onSave={() => {}}
      />,
    ),
  );
  return host;
}

const open = (at: HTMLElement) =>
  act(() => {
    at.querySelector<HTMLElement>(".mg-code-lang")!.click();
  });
const active = () => document.querySelector(".mg-lang-row.is-active")?.textContent;

describe("言語の一覧", () => {
  it("開いた直後は、今の言語の行が選ばれている", () => {
    open(editor("```d2\na -> b\n```\n"));
    expect(active()).toBe("d2");
  });

  it("言語が無い塊では text が選ばれている", () => {
    open(editor("```\nplain\n```\n"));
    expect(active()).toBe("text");
  });

  it("字を打って絞り込むと、先頭が選ばれる", () => {
    open(editor("```d2\na -> b\n```\n"));
    const input = document.querySelector<HTMLInputElement>(".mg-lang-filter")!;
    act(() => {
      input.value = "py";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const first = document.querySelector(".mg-lang-row")?.textContent;
    expect(active()).toBe(first);
  });
});

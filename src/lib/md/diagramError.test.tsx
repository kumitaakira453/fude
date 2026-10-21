// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BodyEditor } from "../../components/BodyEditor";

// 編集面の図のエラーは、図の欄（プレビュー側）の中に出す。

vi.mock("../diagram", async (load) => {
  const real = await load<typeof import("../diagram")>();
  return { ...real, renderDiagram: () => Promise.reject(new Error("Parse error on line 1")) };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
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
  root = null;
  host = null;
});

describe("編集面の図のエラー", () => {
  it("描けないときのエラーの札は、図の欄の中に出る", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <BodyEditor
          body={"```mermaid\nflowchart TD\n  A -->\n```\n"}
          prefix=""
          dark={false}
          className="mg-prose prose"
          onChange={() => {}}
          onSave={() => {}}
        />,
      ),
    );
    // エラーは 1 秒同じ記述のままだったときに出る。
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 1100));
    });
    const err = host.querySelector(".mg-mermaid-err");
    expect(err?.textContent).toContain("Parse error on line 1");
    expect(err?.parentElement?.classList.contains("mg-mermaid")).toBe(true);
  });
});

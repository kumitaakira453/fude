// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BodyEditor } from "../../components/BodyEditor";

// 編集面の図。塊の NodeView が作り直されても（IME の確定の後など）、描き直しが
// 返るまで前に描けた図を出しておく。

// 1 度目の描画だけ返し、2 度目からは返さない（描き直しが終わっていない間を作る）。
let calls = 0;
vi.mock("../diagram", async (load) => {
  const real = await load<typeof import("../diagram")>();
  return {
    ...real,
    renderDiagram: () => {
      calls++;
      return calls === 1 ? Promise.resolve('<svg id="kept"></svg>') : new Promise<string>(() => {});
    },
  };
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

const BODY = "```mermaid\nflowchart TD\n  A --> B\n```\n";

function editor(): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <BodyEditor
        body={BODY}
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

describe("編集面の図の控え", () => {
  it("同じ塊を作り直すと、描き直しが返る前から前の図が出ている", async () => {
    editor();
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 0));
    });
    expect(host!.querySelector(".mg-mermaid-inner svg")?.id).toBe("kept");
    act(() => root?.unmount());
    host?.remove();

    // 作り直し。2 度目の描画は返らないので、出ているのは控えの図だけ。
    const again = editor();
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(again.querySelector(".mg-mermaid-inner svg")?.id).toBe("kept");
  });
});

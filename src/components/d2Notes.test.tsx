// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { D2Notes } from "./D2Doc";

// .d2 の図の下の注釈。場所を取るので、見出しで畳める。

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
  localStorage.clear();
});

const NOTES = [
  { n: "1", text: "一つ目" },
  { n: "2", text: "二つ目" },
];

function show(notes = NOTES) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={createStore()}>
        <D2Notes notes={notes} />
      </Provider>,
    ),
  );
  return host;
}

describe("図の下の注釈", () => {
  it("見出しに件数を出し、押すと畳み、もう一度押すと開く", () => {
    const el = show();
    const head = el.querySelector<HTMLButtonElement>(".mg-d2-notes-head")!;
    expect(head.textContent).toContain("注釈");
    expect(el.querySelector(".mg-d2-notes-count")!.textContent).toBe("2");
    expect(el.querySelectorAll(".mg-d2-note")).toHaveLength(2);
    act(() => head.click());
    expect(el.querySelector(".mg-d2-notes-list")).toBeNull();
    expect(head.getAttribute("aria-expanded")).toBe("false");
    act(() => head.click());
    expect(el.querySelectorAll(".mg-d2-note")).toHaveLength(2);
  });

  it("注釈が無ければ何も出さない", () => {
    const el = show([]);
    expect(el.querySelector(".mg-d2-notes")).toBeNull();
  });
});

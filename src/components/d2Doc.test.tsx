// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { assetVersionAtom, d2ViewAtom, liveEditAtom } from "../state/atoms";
import { D2Doc } from "./D2Doc";

// .d2 のファイル。ソース・分割・図を切り替え、図は描き直しを待つ間も前の図を
// 残す。リアルタイム編集が入なら書けて、打つのが止まったら保存する。

let content = "a -> b";
const written: string[] = [];
vi.mock("../lib/fsAccess", () => ({
  readText: async () => content,
  writeFile: async (_abs: string, text: string) => {
    written.push(text);
  },
  pathExists: async () => true,
}));
const invoked: Array<[string, unknown]> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: unknown) => {
    invoked.push([cmd, args]);
    return "/本/構成.svg";
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: async () => {} }));
vi.mock("../lib/diagram", async (load) => {
  const real = await load<typeof import("../lib/diagram")>();
  return {
    ...real,
    renderDiagram: async (_lang: string, code: string) => {
      if (code.trim().endsWith("->")) throw new Error("1:1: connection missing destination");
      return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" data-code="${code.length}"></svg>`;
    },
  };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  content = "a -> b";
  written.length = 0;
  invoked.length = 0;
});

const wait = (ms: number) =>
  act(async () => {
    await new Promise((ok) => setTimeout(ok, ms));
  });

async function show(opts: { view?: "code" | "split" | "diagram"; live?: boolean } = {}) {
  const store = createStore();
  store.set(d2ViewAtom, opts.view ?? "diagram");
  store.set(liveEditAtom, opts.live ?? true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Provider store={store}>
        <D2Doc abs="/本/構成.d2" />
      </Provider>,
    );
  });
  await wait(0);
  return { el: host, store };
}

const modeButton = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(".mg-d2-modes button")].find((b) => b.textContent === label)!;
const editorOf = (el: HTMLElement): EditorView => {
  const dom = el.querySelector(".mg-d2src")!.shadowRoot!.querySelector<HTMLElement>(".cm-editor")!;
  return EditorView.findFromDOM(dom)!;
};

describe(".d2 のファイル", () => {
  it("開くと図が出て、見せ方はソース・分割・図の 3 つ", async () => {
    const { el } = await show();
    expect(el.querySelector(".mg-d2-figure svg")).not.toBeNull();
    expect([...el.querySelectorAll(".mg-d2-modes button")].map((b) => b.textContent)).toEqual([
      "ソース",
      "分割",
      "図",
    ]);
    expect(modeButton(el, "図").getAttribute("aria-pressed")).toBe("true");
  });

  it("分割ではソースと図が並び、リアルタイム編集が入なら書ける", async () => {
    const { el } = await show();
    act(() => modeButton(el, "分割").click());
    expect(el.querySelector(".mg-d2-source .mg-d2src")).not.toBeNull();
    expect(el.querySelector(".mg-d2-stage")).not.toBeNull();
  });

  it("リアルタイム編集が切なら、ソースは読むだけ", async () => {
    const { el } = await show({ view: "code", live: false });
    expect(el.querySelector(".mg-source")).not.toBeNull();
    expect(el.querySelector(".mg-d2src")).toBeNull();
    expect(el.querySelector(".mg-d2-stage")).toBeNull();
  });

  it("打つのが止まったら保存し、図も描き直す", async () => {
    const { el } = await show({ view: "split" });
    const before = el.querySelector(".mg-d2-figure svg")!.getAttribute("data-code");
    const ed = editorOf(el);
    act(() => ed.dispatch({ changes: { from: ed.state.doc.length, insert: "\nb -> c" } }));
    expect(written).toEqual([]);
    await wait(600);
    expect(written).toEqual(["a -> b\nb -> c"]);
    expect(el.querySelector(".mg-d2-figure svg")!.getAttribute("data-code")).not.toBe(before);
  });

  it("自分の保存が返ってきても手元は変わらず、外での変更は取り込む", async () => {
    const { el, store } = await show({ view: "split" });
    const ed = editorOf(el);
    act(() => ed.dispatch({ changes: { from: ed.state.doc.length, insert: "\nb -> c" } }));
    await wait(600);
    content = "a -> b\nb -> c";
    await act(async () => store.set(assetVersionAtom, (n) => n + 1));
    await wait(0);
    expect(ed.state.doc.toString()).toBe("a -> b\nb -> c");
    expect(written).toHaveLength(1);

    content = "x -> y";
    await act(async () => store.set(assetVersionAtom, (n) => n + 1));
    await wait(0);
    expect(ed.state.doc.toString()).toBe("x -> y");
    // 取り込んだ中身は保存し直さない。
    await wait(600);
    expect(written).toHaveLength(1);
  });

  it("書きかけで描けないときは、前の図を薄く残してエラーの札を出す", async () => {
    const { el } = await show({ view: "split" });
    const ed = editorOf(el);
    act(() => ed.dispatch({ changes: { from: ed.state.doc.length, insert: "\nb ->" } }));
    await wait(400);
    // 1 秒経つまでは札を出さない。
    expect(el.querySelector(".mg-mermaid-err")).toBeNull();
    expect(el.querySelector(".mg-d2-stage.is-stale .mg-d2-figure svg")).not.toBeNull();
    await wait(1000);
    expect(el.querySelector(".mg-mermaid-err-head")?.textContent).toContain("コードエラー");
    expect(el.querySelector(".mg-d2-figure svg")).not.toBeNull();
  });

  it("「SVG に書き出す」は確認してから、開いている .d2 の道筋で書き出す", async () => {
    const { el } = await show();
    const out = [...el.querySelectorAll<HTMLButtonElement>(".mg-imgdoc-bar button")].find(
      (b) => b.textContent === "SVG に書き出す",
    )!;
    await act(async () => out.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("構成.svg を上書きします");
    expect(invoked).toEqual([]);
    const go = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "上書きする")!;
    await act(async () => go.click());
    expect(invoked).toContainEqual(["export_d2", { path: "/本/構成.d2" }]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

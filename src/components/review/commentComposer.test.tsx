// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CommentComposer } from "./CommentComposer";

// 新しいコメントを書く小窓の種類。既定は修正で、欄の頭の「/」で替える。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
let sent: string[] = [];
let closed = 0;

function show() {
  sent = [];
  closed = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <CommentComposer
        anchorRect={{ id: "a", top: 10, bottom: 30, left: 10 }}
        selection="按分額は日割りで算出する"
        busy={false}
        onSubmit={(body) => sent.push(body)}
        onClose={() => closed++}
      />,
    ),
  );
  return host.querySelector("textarea")!;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
});

const type = (field: HTMLTextAreaElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
const key = (field: HTMLElement, k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });
const seat = () => document.querySelector(".mg-kind-seat .mg-kind")?.getAttribute("data-kind") ?? null;

describe("新しいコメントの種類", () => {
  it("既定で修正を付け、送ると本文の頭に [edit] が付く", () => {
    const field = show();
    expect(seat()).toBe("edit");
    type(field, "自明なので削除");
    key(field, "Enter", { metaKey: true });
    expect(sent).toEqual(["[edit] 自明なので削除"]);
  });

  it("/ で種類を替えられる。承認は返信にだけ付くので出さない", () => {
    const field = show();
    type(field, "/");
    const options = Array.from(document.querySelectorAll(".mg-kind-opt")).map((el) => el.textContent);
    expect(options).toEqual(["修正/edit", "質問/ask", "案出し/ideas"]);
    type(field, "/id");
    key(field, "Enter");
    expect(seat()).toBe("ideas");
    type(field, "いくつか書き方を");
    key(field, "Enter", { metaKey: true });
    expect(sent).toEqual(["[ideas] いくつか書き方を"]);
  });

  it("一覧の選択肢を押して選んでも、小窓は閉じない", () => {
    const field = show();
    type(field, "/");
    const ask = Array.from(document.querySelectorAll<HTMLElement>(".mg-kind-opt")).find((el) =>
      el.textContent?.startsWith("質問"),
    )!;
    act(() => {
      ask.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      ask.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(closed).toBe(0);
    expect(seat()).toBe("ask");
  });

  it("種類を外して送ると、印なし（修正として扱う）で送る", () => {
    const field = show();
    key(field, "Backspace");
    expect(seat()).toBeNull();
    type(field, "削除");
    key(field, "Enter", { metaKey: true });
    expect(sent).toEqual(["削除"]);
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ReviewThread } from "../../lib/review";
import { ThreadCard } from "./ReviewScreen";

// 一覧の札。押せば選び、解決の釦はそれと分かれている（押した先が違う）。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const thread: ReviewThread = {
  id: "t1",
  file: "/docs/a.md",
  quote: "引用",
  block_hash: "",
  selection: "選んだ字",
  selection_offset: 0,
  section_path: ["節"],
  base_version: "v1",
  status: { kind: "open" },
  comments: [{ id: "c1", author: "you", body: "ここ直して", created_at: 0 }],
  created_at: 0,
};

let root: Root | null = null;
let host: HTMLElement | null = null;
let picked = 0;
let resolved = 0;

function show() {
  picked = 0;
  resolved = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <ThreadCard
        thread={thread}
        where="節"
        active={false}
        onPick={() => picked++}
        onResolve={() => resolved++}
      />,
    ),
  );
  return {
    card: host.querySelector<HTMLElement>(".mg-thread-card")!,
    done: host.querySelector<HTMLElement>(".mg-thread-done")!,
  };
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

describe("一覧の札", () => {
  it("押すと選ばれる", () => {
    const { card } = show();
    click(card);
    expect(picked).toBe(1);
    expect(resolved).toBe(0);
  });

  it("Enter でも選べる（札は釦ではなくなったので自分で見る）", () => {
    const { card } = show();
    act(() => {
      card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(picked).toBe(1);
  });

  it("解決の釦は選びと分かれている", () => {
    const { done } = show();
    expect(done.title).toContain("解決");
    click(done);
    expect(resolved).toBe(1);
    // 札の選びまでは走らない
    expect(picked).toBe(0);
  });
});

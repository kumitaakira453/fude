// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Block } from "../../lib/blocks";
import type { Resolution } from "../../lib/blockDiff";
import type { ReviewThread } from "../../lib/review";
import { CommentRail } from "./CommentRail";

// 本文の横に出すコメント。
//
// 見たいのは「本文と同じ順に、辿れるものだけが並ぶ」こと。台帳の並び（書いた順）
// のまま出すと本文を行ったり来たりすることになり、居場所を失った指摘を混ぜると
// 押しても飛ぶ先が無い。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const block = (index: number): Block => ({
  index,
  src: "本文",
  start: 0,
  end: 2,
  type: "paragraph",
});

function thread(id: string, over: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id,
    file: "/doc.md",
    quote: "引用のもとの段落",
    block_hash: "",
    selection: `選んだ字 ${id}`,
    selection_offset: 0,
    section_path: [],
    base_version: "v1",
    status: { kind: "open" },
    comments: [{ id: `${id}c1`, author: "you", body: `${id} の指摘`, created_at: 0 }],
    created_at: 0,
    ...over,
  };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
let picked: string[] = [];
let opened: string[] = [];
let resolved: string[] = [];

function show(threads: ReviewThread[], resolutions: Map<string, Resolution>) {
  picked = [];
  opened = [];
  resolved = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <CommentRail
        content={null}
        threads={threads}
        resolutions={resolutions}
        active={null}
        onPick={(id) => picked.push(id)}
        onOpen={(id) => opened.push(id)}
        onResolve={(id) => resolved.push(id)}
      />,
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
});

const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".mg-rail-card"));
const quotes = () =>
  Array.from(document.querySelectorAll(".mg-rail-quote")).map((el) => el.textContent);

describe("CommentRail", () => {
  it("本文の並び順に出す（書いた順ではなく）", () => {
    show(
      [thread("t1"), thread("t2")],
      new Map<string, Resolution>([
        ["t1", { state: "unchanged", index: 3, head: block(3) }],
        ["t2", { state: "unchanged", index: 0, head: block(0) }],
      ]),
    );
    expect(quotes()).toEqual(["選んだ字 t2", "選んだ字 t1"]);
  });

  it("居場所を失った指摘は出さない", () => {
    // 本文に印が出ないものを欄にだけ並べると、押しても飛ぶ先が無い。
    show(
      [thread("t1"), thread("t2")],
      new Map<string, Resolution>([
        ["t1", { state: "unchanged", index: 0, head: block(0) }],
        ["t2", { state: "unknown", index: -1 }],
      ]),
    );
    expect(quotes()).toEqual(["選んだ字 t1"]);
  });

  it("対応付けが済んでいない指摘も出さない", () => {
    show([thread("t1")], new Map());
    expect(cards()).toHaveLength(0);
    expect(document.body.textContent).toContain("未解決のコメントはありません");
  });

  it("返信まで並べる", () => {
    show(
      [
        thread("t1", {
          comments: [
            { id: "c1", author: "you", body: "ここ直して", created_at: 0 },
            { id: "c2", author: "AI", body: "直しました", created_at: 1 },
          ],
        }),
      ],
      new Map<string, Resolution>([["t1", { state: "unchanged", index: 0, head: block(0) }]]),
    );
    const text = cards()[0].textContent ?? "";
    expect(text).toContain("ここ直して");
    expect(text).toContain("直しました");
    expect(text).toContain("AI");
  });

  it("札を押すとその指摘を選ぶ", () => {
    show(
      [thread("t1")],
      new Map<string, Resolution>([["t1", { state: "unchanged", index: 0, head: block(0) }]]),
    );
    act(() => cards()[0].click());
    expect(picked).toEqual(["t1"]);
  });

  it("解決と一覧で開くは、札を押すのとは別に届く", () => {
    show(
      [thread("t1")],
      new Map<string, Resolution>([["t1", { state: "unchanged", index: 0, head: block(0) }]]),
    );
    const acts = cards()[0].querySelectorAll<HTMLElement>(".mg-rail-act");
    act(() => acts[0].click());
    act(() => acts[1].click());
    expect(resolved).toEqual(["t1"]);
    expect(opened).toEqual(["t1"]);
    // 札そのものは選ばれていない（押下は釦で止まる）。
    expect(picked).toEqual([]);
  });
});

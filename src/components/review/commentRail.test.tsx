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
// 見たいのは「本文と同じ高さに、辿れるものだけが並ぶ」こと。台帳の並び（書いた順）
// のまま積むと本文を送ったときに札だけが取り残されるし、居場所を失った指摘を
// 列に混ぜると押しても飛ぶ先が無い。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  // 置き直しは 1 フレーム間引いてから走る。試験では待たずに見たいので、
  // その場で呼ぶ。
  globalThis.requestAnimationFrame = ((run: FrameRequestCallback) => {
    run(0);
    return 0;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
});

// jsdom は描画を持たないので、矩形は当て木で置く。
const rects = new WeakMap<Element, DOMRect>();
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return rects.get(this) ?? new DOMRect(0, 0, 0, 0);
  };
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

// data-mg-block を持つ本文。渡した「ブロック番号 → 上端」で矩形を置く。
function body(tops: Record<number, number>): HTMLElement {
  const article = document.createElement("article");
  for (const [index, top] of Object.entries(tops)) {
    const el = document.createElement("div");
    el.dataset.mgBlock = index;
    rects.set(el, new DOMRect(0, top, 600, 40));
    article.appendChild(el);
  }
  document.body.appendChild(article);
  return article;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
let picked: string[] = [];
let opened: string[] = [];
let resolved: string[] = [];
let replied: { id: string; body: string }[] = [];

function show(
  threads: ReviewThread[],
  resolutions: Map<string, Resolution>,
  over: { loose?: ReviewThread[]; content?: HTMLElement | null } = {},
) {
  picked = [];
  opened = [];
  resolved = [];
  replied = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <CommentRail
        content={over.content ?? null}
        scroller={null}
        threads={threads}
        resolutions={resolutions}
        loose={over.loose ?? []}
        active={null}
        onPick={(id) => picked.push(id)}
        onOpen={(id) => opened.push(id)}
        onResolve={(id) => resolved.push(id)}
        onReply={(id, text) => replied.push({ id, body: text })}
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
const flowed = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".mg-rail-flow > .mg-rail-card"));
const quotes = () =>
  Array.from(document.querySelectorAll(".mg-rail-quote")).map((el) => el.textContent);
const click = (el: HTMLElement) => act(() => el.click());

const at = (index: number) => ({ state: "unchanged", index, head: block(index) }) as const;

describe("CommentRail", () => {
  it("本文の並び順に出す（書いた順ではなく）", () => {
    show(
      [thread("t1"), thread("t2")],
      new Map<string, Resolution>([
        ["t1", at(3)],
        ["t2", at(0)],
      ]),
    );
    expect(quotes()).toEqual(["選んだ字 t2", "選んだ字 t1"]);
  });

  it("居場所を失った指摘は、流れる列に混ぜない", () => {
    // 本文に印が出ないものを列に並べると、押しても飛ぶ先が無い。
    show(
      [thread("t1"), thread("t2")],
      new Map<string, Resolution>([
        ["t1", at(0)],
        ["t2", { state: "unknown", index: -1 }],
      ]),
    );
    expect(flowed()).toHaveLength(1);
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
      new Map<string, Resolution>([["t1", at(0)]]),
    );
    const text = cards()[0].textContent ?? "";
    expect(text).toContain("ここ直して");
    expect(text).toContain("直しました");
    expect(text).toContain("AI");
  });

  it("札を押すとその指摘を選ぶ", () => {
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]));
    click(cards()[0]);
    expect(picked).toEqual(["t1"]);
  });

  it("解決と一覧で開くは、札を押すのとは別に届く", () => {
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]));
    const acts = cards()[0].querySelectorAll<HTMLElement>(".mg-rail-act");
    click(acts[0]);
    click(acts[1]);
    expect(resolved).toEqual(["t1"]);
    expect(opened).toEqual(["t1"]);
    // 札そのものは選ばれていない（押下は釦で止まる）。
    expect(picked).toEqual([]);
  });
});

describe("本文から外れた指摘", () => {
  const loose = [thread("x1"), thread("x2")];

  it("畳んだ見出しで件数を知らせ、開くと中身が出る", () => {
    show([], new Map(), { loose });
    expect(document.body.textContent).toContain("本文から外れたコメント 2 件");
    expect(cards()).toHaveLength(0);
    click(document.querySelector<HTMLElement>(".mg-rail-loose-top")!);
    expect(cards()).toHaveLength(2);
  });

  it("押しても飛ばさず、一覧で開く", () => {
    show([], new Map(), { loose });
    click(document.querySelector<HTMLElement>(".mg-rail-loose-top")!);
    click(cards()[0]);
    expect(opened).toEqual(["x1"]);
    expect(picked).toEqual([]);
  });

  it("流れる列には入れない（飛び先が無いので置き場所が決まらない）", () => {
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]), { loose });
    click(document.querySelector<HTMLElement>(".mg-rail-loose-top")!);
    expect(flowed()).toHaveLength(1);
  });
});

describe("返信", () => {
  it("書いて ⌘Enter で送ると、その本文が渡る", () => {
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]));
    click(cards()[0].querySelector<HTMLElement>(".mg-rail-reply-open")!);
    const box = cards()[0].querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(box, "直しておきます");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
      );
    });
    expect(replied).toEqual([{ id: "t1", body: "直しておきます" }]);
  });

  it("空のまま送ろうとしたら、何も渡さずに畳む", () => {
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]));
    click(cards()[0].querySelector<HTMLElement>(".mg-rail-reply-open")!);
    click(cards()[0].querySelector<HTMLElement>(".mg-rail-reply-send")!);
    expect(replied).toEqual([]);
    expect(cards()[0].querySelector("textarea")).toBeNull();
  });
});

describe("札の置き場所", () => {
  it("指摘したブロックの高さに合わせる", () => {
    const content = body({ 0: 100, 5: 400 });
    show(
      [thread("t1"), thread("t2")],
      new Map<string, Resolution>([
        ["t1", at(0)],
        ["t2", at(5)],
      ]),
      { content },
    );
    // 欄の上端は 50。ブロックは 100 と 400 なので、そこからの差が行き先。
    const rail = document.querySelector<HTMLElement>(".mg-rail")!;
    rects.set(rail, new DOMRect(0, 50, 288, 800));
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(flowed().map((el) => el.style.top)).toEqual(["50px", "350px"]);
  });

  it("重なりそうなら下へ押し下げる", () => {
    const content = body({ 0: 100, 1: 100 });
    show(
      [thread("t1"), thread("t2")],
      new Map<string, Resolution>([
        ["t1", at(0)],
        ["t2", at(1)],
      ]),
      { content },
    );
    const rail = document.querySelector<HTMLElement>(".mg-rail")!;
    rects.set(rail, new DOMRect(0, 100, 288, 800));
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    // jsdom では札の背丈が 0 なので、押し下げは間隔のぶんだけになる。
    expect(flowed().map((el) => el.style.top)).toEqual(["0px", "8px"]);
  });

  it("まだ描かれていないブロックの札は隠す", () => {
    const content = body({ 0: 100 });
    show(
      [thread("t1"), thread("t2")],
      new Map<string, Resolution>([
        ["t1", at(0)],
        ["t2", at(9)],
      ]),
      { content },
    );
    expect(flowed().map((el) => el.style.visibility)).toEqual(["", "hidden"]);
  });
});

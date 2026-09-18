// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Block } from "../../lib/blocks";
import type { Resolution } from "../../lib/blockDiff";
import type { ReviewThread } from "../../lib/review";
import { CommentRail } from "./CommentRail";

// 本文の横に出すコメント。
//
// 見たいのは 2 つ。札が本文と同じ高さ・同じ順に並ぶことと、開くのが 1 枚だけで
// あること。全部を開いたまま並べると、指摘が数件あるだけで欄が埋まり、いま見て
// いる 1 件がどれなのか分からなくなる。

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

// 片付いた指摘。札の見た目と操作は台帳の status から決まる。
const settled = (id: string) =>
  thread(id, { status: { kind: "resolved", by: "you", at: 0 } });

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
let picked: (string | null)[] = [];
let opened: string[] = [];
let resolved: string[] = [];
let reopened: string[] = [];
let replied: { id: string; body: string }[] = [];

function show(
  threads: ReviewThread[],
  resolutions: Map<string, Resolution>,
  over: {
    loose?: ReviewThread[];
    done?: ReviewThread[];
    content?: HTMLElement | null;
  } = {},
) {
  picked = [];
  opened = [];
  resolved = [];
  reopened = [];
  replied = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // 開いている 1 枚と、外れた指摘の畳み開きは呼ぶ側が持つ（DocPane と同じ形）。
  function Host() {
    const [openLoose, setOpenLoose] = useState(false);
    const [all, setAll] = useState(false);
    const [active, setActive] = useState<string | null>(null);
    return (
      <CommentRail
        content={over.content ?? null}
        scroller={null}
        threads={threads}
        done={over.done ?? []}
        resolutions={resolutions}
        loose={over.loose ?? []}
        all={all}
        onAll={setAll}
        openLoose={openLoose}
        onOpenLoose={setOpenLoose}
        active={active}
        onPick={(id) => {
          picked.push(id);
          setActive(id);
        }}
        onOpen={(id) => opened.push(id)}
        onResolve={(id) => resolved.push(id)}
        onReopen={(id) => reopened.push(id)}
        onReply={(id, text) => replied.push({ id, body: text })}
      />
    );
  }
  act(() => root!.render(<Host />));
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
const peeks = () =>
  Array.from(document.querySelectorAll(".mg-rail-peek")).map((el) => el.textContent);
const opens = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".mg-rail-card.is-open"));
const click = (el: HTMLElement) => act(() => el.click());
const openStray = () => click(document.querySelector<HTMLElement>(".mg-rail-stray-top")!);
const picks = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".mg-rail-pick > button"));

const at = (index: number) => ({ state: "unchanged", index, head: block(index) }) as const;

// 欄に高さを与えて測り直させる。丈が 0 のあいだ（画面が狭い・分割中）は
// 測れないので、置き直しは走らない。
function measure(top: number) {
  rects.set(
    document.querySelector<HTMLElement>(".mg-rail")!,
    new DOMRect(0, top, 288, 800),
  );
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

describe("並び", () => {
  it("本文の並び順に出す（書いた順ではなく）", () => {
    show(
      [thread("t1"), thread("t2")],
      new Map<string, Resolution>([
        ["t1", at(3)],
        ["t2", at(0)],
      ]),
    );
    expect(peeks()).toEqual(["t2 の指摘", "t1 の指摘"]);
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
    expect(document.body.textContent).toContain("コメントはありません");
  });
});

describe("絞り込み", () => {
  const two = (over: { done?: ReviewThread[]; loose?: ReviewThread[] } = {}) =>
    show(
      [thread("t1"), thread("t2")],
      new Map<string, Resolution>([
        ["t1", at(0)],
        ["t2", at(1)],
        ["d1", at(2)],
      ]),
      over,
    );

  it("切り替えにそれぞれの件数を出す", () => {
    two({ done: [settled("d1")], loose: [thread("x1")] });
    expect(picks().map((el) => el.textContent)).toEqual(["未解決 3", "すべて 4"]);
  });

  it("既定は未解決だけ。切り替えると片付いたものも本文の並び順で混ざる", () => {
    two({ done: [settled("d1")] });
    expect(peeks()).toEqual(["t1 の指摘", "t2 の指摘"]);
    click(picks()[1]);
    expect(peeks()).toEqual(["t1 の指摘", "t2 の指摘", "d1 の指摘"]);
  });

  it("片付いた札はそれと分かる", () => {
    two({ done: [settled("d1")] });
    click(picks()[1]);
    expect(document.querySelectorAll(".mg-rail-card.is-done")).toHaveLength(1);
  });

  it("片付いた札の操作は、解決ではなく取り消し", () => {
    two({ done: [settled("d1")] });
    click(picks()[1]);
    click(cards()[2]);
    const acts = opens()[0].querySelectorAll<HTMLElement>(".mg-rail-act");
    click(acts[0]);
    expect(reopened).toEqual(["d1"]);
    expect(resolved).toEqual([]);
  });
});

describe("畳んだ姿", () => {
  it("最初の書き込みを 1 行で出し、引用も返信欄も出さない", () => {
    show(
      [
        thread("t1", {
          comments: [{ id: "c1", author: "you", body: "**ここ**直して", created_at: 0 }],
        }),
      ],
      new Map<string, Resolution>([["t1", at(0)]]),
    );
    // 組版はしないので、記法の印は落として字にする。
    expect(peeks()).toEqual(["ここ直して"]);
    expect(document.querySelector(".mg-rail-quote")).toBeNull();
    expect(document.querySelector(".mg-rail-reply-open")).toBeNull();
  });

  it("返信の数と、返事が届いている印を出す", () => {
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
    expect(document.querySelector(".mg-rail-chip.is-answered")).not.toBeNull();
    expect(
      document.querySelector(".mg-rail-chip:not(.is-answered)")?.textContent,
    ).toContain("1");
  });
});

describe("開いた姿", () => {
  const two = () =>
    show(
      [thread("t1"), thread("t2")],
      new Map<string, Resolution>([
        ["t1", at(0)],
        ["t2", at(1)],
      ]),
    );

  it("押すと開いて、会話が全部出る", () => {
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
    click(cards()[0]);
    const text = opens()[0].textContent ?? "";
    expect(text).toContain("ここ直して");
    expect(text).toContain("直しました");
    expect(document.querySelector(".mg-rail-quote")?.textContent).toBe("選んだ字 t1");
  });

  it("開くのは 1 枚だけ", () => {
    two();
    click(cards()[0]);
    click(cards()[1]);
    expect(opens()).toHaveLength(1);
    expect(picked).toEqual(["t1", "t2"]);
  });

  it("開いている札を押しても畳まない", () => {
    // 読んでいる途中に閉じると、戻す手立てが無い。
    two();
    click(cards()[0]);
    click(opens()[0]);
    expect(opens()).toHaveLength(1);
  });

  it("一覧への口は、開いた札では隠さない", () => {
    // ホバーしないと出ないと、事実上たどり着けない。
    two();
    click(cards()[0]);
    expect(opens()[0].querySelector('[aria-label="一覧で開く"]')).not.toBeNull();
  });

  it("解決と一覧で開くは、札を押すのとは別に届く", () => {
    two();
    click(cards()[0]);
    const acts = opens()[0].querySelectorAll<HTMLElement>(".mg-rail-act");
    click(acts[0]);
    click(acts[1]);
    expect(resolved).toEqual(["t1"]);
    expect(opened).toEqual(["t1"]);
  });
});

describe("本文から外れた指摘", () => {
  const loose = [thread("x1"), thread("x2")];

  it("帯の札から開くと中身が出る", () => {
    show([], new Map(), { loose });
    expect(document.querySelector(".mg-rail-stray-top")?.textContent).toContain("2");
    expect(cards()).toHaveLength(0);
    openStray();
    expect(cards()).toHaveLength(2);
  });

  it("押しても画面は切り替わらない。選ぶだけ", () => {
    // 欄に中身が出ているのだから、読むだけの一押しで全画面へ移さない。
    show([], new Map(), { loose });
    openStray();
    click(cards()[0]);
    expect(picked).toEqual(["x1"]);
    expect(opened).toEqual([]);
  });

  it("一覧で開くのは、その釦を押したときだけ", () => {
    show([], new Map(), { loose });
    openStray();
    click(cards()[0]);
    const acts = opens()[0].querySelectorAll<HTMLElement>(".mg-rail-act");
    click(acts[acts.length - 1]);
    expect(opened).toEqual(["x1"]);
  });

  it("流れる列には入れない（飛び先が無いので置き場所が決まらない）", () => {
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]), { loose });
    openStray();
    expect(flowed()).toHaveLength(1);
  });
});

describe("返信", () => {
  const one = () => {
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]));
    click(cards()[0]);
    click(opens()[0].querySelector<HTMLElement>(".mg-rail-reply-open")!);
  };

  it("書いて ⌘Enter で送ると、その本文が渡る", () => {
    one();
    const box = opens()[0].querySelector<HTMLTextAreaElement>("textarea")!;
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
    one();
    click(opens()[0].querySelector<HTMLElement>(".mg-rail-reply-send")!);
    expect(replied).toEqual([]);
    expect(opens()[0].querySelector("textarea")).toBeNull();
  });
});

describe("箇所へ送る", () => {
  // 押した札の箇所まで本文を送る。札はその高さに居るので、送った先でもついてくる。
  function watch(content: HTMLElement, index: number) {
    const el = content.querySelector(`[data-mg-block="${index}"]`)!;
    const sent: unknown[] = [];
    el.scrollIntoView = ((how: unknown) => sent.push(how)) as typeof el.scrollIntoView;
    return sent;
  }

  it("札を押すと、その箇所へ送る", () => {
    const content = body({ 0: 100 });
    const sent = watch(content, 0);
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]), { content });
    click(cards()[0]);
    expect(sent).toEqual([{ block: "center", behavior: "smooth" }]);
  });

  it("開いたあとも、引用を押せばその箇所へ戻せる", () => {
    const content = body({ 0: 100 });
    const sent = watch(content, 0);
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]), { content });
    click(cards()[0]);
    click(opens()[0].querySelector<HTMLElement>(".mg-rail-quote")!);
    expect(sent).toHaveLength(2);
  });

  it("飛び先を持たない札からは送らない", () => {
    show([], new Map(), { loose: [thread("x1")] });
    openStray();
    click(cards()[0]);
    expect(opens()[0].querySelector<HTMLButtonElement>(".mg-rail-quote")!.disabled).toBe(
      true,
    );
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
    measure(50);
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
    measure(100);
    // jsdom では札の背丈が 0 なので、押し下げは間隔のぶんだけになる。
    expect(flowed().map((el) => el.style.top)).toEqual(["0px", "8px"]);
  });

  it("欄が出ていないあいだは何も書かない", () => {
    // 丈が 0 のときに書くと、測れていない値で札を置いてしまう。
    const content = body({ 0: 100 });
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]), { content });
    expect(flowed()[0].style.top).toBe("");
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
    measure(0);
    expect(flowed().map((el) => el.style.visibility)).toEqual(["", "hidden"]);
  });
});

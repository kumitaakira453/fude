// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Block } from "../../lib/blocks";
import type { Resolution } from "../../lib/blockDiff";
import type { RailFilter, ReviewThread } from "../../lib/review";
import { CommentRail } from "./CommentRail";

// 本文の横に出すコメント。
//
// 見たいのは、札が本文と同じ高さ・同じ順に並ぶことと、押した流れのまま返信を
// 書き始められること。

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
  // jsdom は持っていない。送り先は当て木で見るので、素は何もしない口にする。
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
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
let shown: string[] = [];
let replied: { id: string; body: string }[] = [];
let rewrote: { id: string; comment: string; body: string }[] = [];
let erased: { id: string; comment: string }[] = [];

function show(
  threads: ReviewThread[],
  resolutions: Map<string, Resolution>,
  over: {
    loose?: ReviewThread[];
    done?: ReviewThread[];
    content?: HTMLElement | null;
    // 本文の印から選ばれた状態で出す。
    active?: string;
    // 始めの絞り込み。既定は「未対応」。
    filter?: RailFilter;
  } = {},
) {
  picked = [];
  opened = [];
  resolved = [];
  reopened = [];
  shown = [];
  replied = [];
  rewrote = [];
  erased = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // 開いている 1 枚と、外れた指摘の畳み開きは呼ぶ側が持つ（DocPane と同じ形）。
  function Host() {
    const railRef = useRef<HTMLElement | null>(null);
    const [filter, setFilter] = useState<RailFilter>(over.filter ?? "todo");
    const [active, setActive] = useState<string | null>(over.active ?? null);
    return (
      <CommentRail
        railRef={railRef}
        content={over.content ?? null}
        scroller={null}
        threads={threads}
        done={over.done ?? []}
        resolutions={resolutions}
        loose={over.loose ?? []}
        filter={filter}
        onFilter={setFilter}
        width={288}
        active={active}
        onPick={(id) => {
          picked.push(id);
          setActive(id);
        }}
        onShow={(id, block) => {
          shown.push(id);
          over.content
            ?.querySelector(`[data-mg-block="${block}"]`)
            ?.scrollIntoView({ block: "center", behavior: "smooth" });
        }}
        onOpen={(id) => opened.push(id)}
        onResolve={(id) => resolved.push(id)}
        onReopen={(id) => reopened.push(id)}
        onReply={(id, text) => replied.push({ id, body: text })}
        onRewrite={(id, comment, body) => rewrote.push({ id, comment, body })}
        onErase={(id, comment) => erased.push({ id, comment })}
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
// 札は引用で見分ける。会話は全部出ているので、並びはこれで足りる。
const quotes = () =>
  Array.from(document.querySelectorAll(".mg-rail-quote")).map((el) => el.textContent);
const box = (card: HTMLElement) => card.querySelector<HTMLTextAreaElement>("textarea");
const click = (el: HTMLElement) => act(() => el.click());
// 入力欄から焦点が外れる拍子を避けるため、確定は押下（mousedown）で拾っている。
const press = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
const openStray = () => click(document.querySelector<HTMLElement>(".mg-rail-stray-top")!);
const picks = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".mg-rail-opt"));
const openFilter = () => click(document.querySelector<HTMLElement>(".mg-rail-chip")!);
// 絞り込みを選ぶ。札を押して開き、名前で選ぶ。
const pick = (name: string) => {
  openFilter();
  const hit = picks().find((el) => el.textContent?.startsWith(name));
  if (!hit) throw new Error(`絞り込みが無い: ${name}`);
  click(hit);
};

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

  it("選択肢にそれぞれの件数を出す", () => {
    two({ done: [settled("d1")], loose: [thread("x1")] });
    openFilter();
    expect(picks().map((el) => el.textContent)).toEqual([
      "未対応返信も解決もまだ3",
      "未解決返信済みも含む3",
      "解決済み片付いたもの1",
      "すべて4",
    ]);
  });

  it("既定は未対応。返信の付いた指摘は残らない", () => {
    two({ done: [settled("d1")] });
    expect(quotes()).toEqual(["選んだ字 t1", "選んだ字 t2"]);
    pick("未解決");
    expect(quotes()).toEqual(["選んだ字 t1", "選んだ字 t2"]);
    pick("すべて");
    expect(quotes()).toEqual(["選んだ字 t1", "選んだ字 t2", "選んだ字 d1"]);
  });

  it("片付いたものだけも出せる", () => {
    two({ done: [settled("d1")] });
    pick("解決済み");
    expect(quotes()).toEqual(["選んだ字 d1"]);
  });

  it("片付いた札はそれと分かる", () => {
    two({ done: [settled("d1")] });
    pick("すべて");
    expect(document.querySelectorAll(".mg-rail-card.is-done")).toHaveLength(1);
  });

  it("片付いた札の操作は、解決ではなく取り消し", () => {
    two({ done: [settled("d1")] });
    pick("すべて");
    const acts = cards()[2].querySelectorAll<HTMLElement>(".mg-rail-act");
    click(acts[0]);
    expect(reopened).toEqual(["d1"]);
    expect(resolved).toEqual([]);
  });
});

describe("自分の書き込み", () => {
  const two = (over: Partial<ReviewThread> = {}) =>
    show([thread("t1", over)], new Map<string, Resolution>([["t1", at(0)]]), {
      filter: "all",
    });
  const own = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>(".mg-rail-own [aria-label]"),
    ).map((el) => el.getAttribute("aria-label"));

  it("最後の書き込みが自分のものなら、直せる・消せる", () => {
    two();
    click(cards()[0]);
    expect(own()).toEqual(["書き直す", "削除"]);
  });

  it("最後が AI の返信なら出さない", () => {
    two({
      comments: [
        { id: "c1", author: "you", body: "ここ直して", created_at: 0 },
        { id: "c2", author: "AI", body: "直しました", created_at: 1 },
      ],
    });
    click(cards()[0]);
    expect(own()).toEqual([]);
  });

  it("途中の自分の書き込みには出さない", () => {
    two({
      comments: [
        { id: "c1", author: "you", body: "ひとつ目", created_at: 0 },
        { id: "c2", author: "you", body: "ふたつ目", created_at: 1 },
      ],
    });
    click(cards()[0]);
    // 出るのは最後の 1 つぶんだけ。
    expect(own()).toEqual(["書き直す", "削除"]);
    expect(document.querySelectorAll(".mg-rail-own")).toHaveLength(1);
  });

  it("直すとその場で書き換わり、消すと呼ぶ側へ伝わる", () => {
    two();
    click(cards()[0]);
    click(document.querySelector<HTMLElement>('.mg-rail-own [aria-label="書き直す"]')!);
    const field = cards()[0].querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(field, "直した本文");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    press(document.querySelector<HTMLElement>(".mg-rail-send .is-go")!);
    expect(rewrote).toEqual([{ id: "t1", comment: "t1c1", body: "直した本文" }]);

    click(document.querySelector<HTMLElement>('.mg-rail-own [aria-label="削除"]')!);
    expect(erased).toEqual([{ id: "t1", comment: "t1c1" }]);
  });
});

describe("札の姿", () => {
  // 札の姿を見る組。返信の付いた会話も出したいので、絞り込みは「すべて」。
  const talk = (over: Partial<ReviewThread> = {}) =>
    show([thread("t1", over)], new Map<string, Resolution>([["t1", at(0)]]), {
      filter: "all",
    });

  it("最初から会話を全部出す", () => {
    // 畳んでおくと、読むたびに開く操作が挟まるだけで出てくるものは同じ。
    talk({
      comments: [
        { id: "c1", author: "you", body: "ここ直して", created_at: 0 },
        { id: "c2", author: "AI", body: "直しました", created_at: 1 },
      ],
    });
    const text = cards()[0].textContent ?? "";
    expect(text).toContain("ここ直して");
    expect(text).toContain("直しました");
    expect(quotes()).toEqual(["選んだ字 t1"]);
  });

  it("押していない札には返信の口を出さない", () => {
    talk();
    expect(box(cards()[0])).toBeNull();
  });

  it("本文の印から選ばれただけでは、返信の口を出さない", () => {
    // 読んでいる途中に入力欄が割り込むと、印を押すのが書く操作になってしまう。
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]), { active: "t1" });
    expect(box(cards()[0])).toBeNull();
    // どれの話かは分かるようにする。
    expect(cards()[0].classList.contains("is-on")).toBe(true);
  });

  it("押すとその指摘を選び、返信の口が出て焦点も入る", () => {
    // 釦で入力欄を生やすと、押した流れが一度切れる。
    talk();
    click(cards()[0]);
    expect(picked).toEqual(["t1"]);
    expect(box(cards()[0])).not.toBeNull();
    expect(document.activeElement).toBe(box(cards()[0]));
    expect(cards()[0].querySelector(".mg-rail-send")).toBeNull();
  });

  it("解決と一覧で開くは、札を押すのとは別に届く", () => {
    talk();
    const acts = cards()[0].querySelectorAll<HTMLElement>(".mg-rail-act");
    click(acts[0]);
    click(acts[1]);
    expect(resolved).toEqual(["t1"]);
    expect(opened).toEqual(["t1"]);
    expect(picked).toEqual([]);
  });

  it("別の画面への口を持つ", () => {
    talk();
    expect(cards()[0].querySelector('[aria-label="別の画面で開く"]')).not.toBeNull();
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
    click(
      cards()[0].querySelector<HTMLElement>('.mg-rail-acts [aria-label="別の画面で開く"]')!,
    );
    expect(opened).toEqual(["x1"]);
  });

  it("流れる列には入れない（飛び先が無いので置き場所が決まらない）", () => {
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]), { loose });
    openStray();
    expect(flowed()).toHaveLength(1);
  });
});

describe("返信", () => {
  const typed = (body: string) => {
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]));
    click(cards()[0]);
    const field = box(cards()[0])!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(field, body);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return field;
  };

  it("書いて ⌘Enter で送ると、その本文が渡る", () => {
    const field = typed("直しておきます");
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
      );
    });
    expect(replied).toEqual([{ id: "t1", body: "直しておきます" }]);
  });

  it("打ったものがあるときだけ、送る口を出す", () => {
    const field = typed("直しておきます");
    expect(cards()[0].querySelector(".mg-rail-send")).not.toBeNull();
    click(cards()[0].querySelector<HTMLElement>(".mg-rail-reply-send")!);
    expect(replied).toEqual([{ id: "t1", body: "直しておきます" }]);
    expect(field.value).toBe("");
  });

  it("書きかけがあるうちは、選びが外れても口を閉じない", () => {
    show(
      [thread("t1"), thread("t2")],
      new Map<string, Resolution>([
        ["t1", at(0)],
        ["t2", at(1)],
      ]),
    );
    click(cards()[0]);
    const field = box(cards()[0])!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(field, "書きかけ");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(cards()[1]);
    expect(box(cards()[0])?.value).toBe("書きかけ");
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

  it("何度押しても、そのたびに送り直す", () => {
    const content = body({ 0: 100 });
    const sent = watch(content, 0);
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]), { content });
    click(cards()[0]);
    click(cards()[0]);
    expect(sent).toHaveLength(2);
  });

  it("入力欄を押したときは送らない（打っている最中に本文が動かない）", () => {
    const content = body({ 0: 100 });
    const sent = watch(content, 0);
    show([thread("t1")], new Map<string, Resolution>([["t1", at(0)]]), { content });
    click(cards()[0]);
    click(box(cards()[0])!);
    expect(sent).toHaveLength(1);
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

  it("選んだ札はその箇所に据え、ほかを上下へ逃がす", () => {
    // 一律に下へ押し下げると、上に何枚か溜まっているだけで選んだ札が
    // 箇所からずり落ちる。
    const content = body({ 0: 0, 1: 0, 2: 0 });
    show(
      [thread("t1"), thread("t2"), thread("t3")],
      new Map<string, Resolution>([
        ["t1", at(0)],
        ["t2", at(1)],
        ["t3", at(2)],
      ]),
      { content },
    );
    measure(0);
    expect(flowed().map((el) => el.style.top)).toEqual(["0px", "8px", "16px"]);
    click(cards()[1]);
    measure(0);
    // jsdom では札の背丈が 0 なので、離れるのは間隔のぶんだけ。
    expect(flowed().map((el) => el.style.top)).toEqual(["-8px", "0px", "8px"]);
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

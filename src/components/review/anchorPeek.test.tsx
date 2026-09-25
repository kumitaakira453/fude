// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Marked } from "../../lib/reviewMarks";
import { AnchorOverlay } from "./AnchorOverlay";

// 本文の上に出るコメントのカード。
//
// 押した瞬間に書き直しへ入る。click を待つと、押している間に本文の選択が
// 始まって「ドラッグ中はカードを出さない」規則に閉じられ、押下がどこにも
// 届かない（実機では「押すとカードが消えて本文が選択される」と出る）。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!globalThis.MutationObserver) {
    globalThis.MutationObserver = class {
      observe() {}
      disconnect() {}
    } as unknown as typeof MutationObserver;
  }
});

const SPOT = { top: 10, left: 20, width: 100, height: 16 };

function marked(mine: boolean): Marked {
  return {
    marks: [
      {
        id: "t1",
        moved: false,
        guess: false,
        areas: [],
    edges: [],
    slab: false,
        spots: [SPOT],
        hit: { id: "t1" } as Marked["marks"][number]["hit"],
        note: "**もと**の言葉",
        more: 0,
        who: "you",
        at: Date.now(),
        answered: false,
        comment: "c1",
        mine,
      },
    ],
    pending: [],
  };
}

let root: Root | null = null;
let content: HTMLElement | null = null;
const edits: [string, string, string][] = [];
const picks: string[] = [];

function open(mine = true, peek = true) {
  content = document.createElement("div");
  // 重ねる先の矩形。測る基準になるので原点を決めておく。
  content.getBoundingClientRect = () =>
    ({ top: 0, left: 0, width: 600, height: 400, bottom: 400, right: 600 }) as DOMRect;
  document.body.appendChild(content);
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <AnchorOverlay
        content={content}
        contentKey="f.md"
        measure={() => marked(mine)}
        onPick={(hit) => picks.push(hit.id)}
        peek={peek}
        onEdit={(t, c, b) => edits.push([t, c, b])}
        onRemove={() => {}}
        onResolve={() => {}}
      />,
    ),
  );
}

// 印の上へ指を運ぶ。当たり判定は重ねた矩形で見ているので、その中の点を渡す。
function hover() {
  act(() => {
    content!.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: SPOT.left + 5,
        clientY: SPOT.top + 5,
        bubbles: true,
      }),
    );
  });
  act(() => vi.runAllTimers());
}

function card(): HTMLElement | null {
  return document.querySelector(".mg-review-peek");
}

function press(el: Element): MouseEvent {
  const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true, buttons: 1 });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

afterEach(() => {
  act(() => root?.unmount());
  content?.remove();
  document.querySelectorAll("div").forEach((el) => el.remove());
  edits.length = 0;
  picks.length = 0;
  root = null;
  content = null;
  vi.useRealTimers();
});

describe("本文の上のカード", () => {
  it("押した瞬間に書き直しへ入り、本文の選択は始めさせない", () => {
    vi.useFakeTimers();
    open();
    hover();
    const box = card();
    expect(box).not.toBeNull();
    expect(box!.textContent).toContain("クリックで書き直す");

    const press1 = press(box!);
    // 押下を止めていないと、本文の選択が始まってカードが閉じる
    expect(press1.defaultPrevented).toBe(true);
    const input = document.querySelector<HTMLTextAreaElement>(
      ".mg-review-peek textarea",
    );
    expect(input).not.toBeNull();
    // 記法のまま出す（組版した字ではなく、書いたもの）
    expect(input!.value).toBe("**もと**の言葉");
  });

  it("書いている間は、押しながら動かしてもカードが閉じない", () => {
    vi.useFakeTimers();
    open();
    hover();
    press(card()!);

    act(() => {
      content!.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 400, clientY: 300, buttons: 1, bubbles: true }),
      );
    });
    act(() => vi.runAllTimers());
    expect(card()).not.toBeNull();
  });

  it("横の欄に中身が出ているときは、カードを出さない", () => {
    // 同じことを 2 か所で言うと、どちらを読めばいいのか決まらない。
    vi.useFakeTimers();
    open(true, false);
    hover();
    expect(card()).toBeNull();
  });

  it("カードを出さないときは、印を押すと横の欄へ渡す", () => {
    vi.useFakeTimers();
    open(true, false);
    act(() => {
      content!.dispatchEvent(
        new MouseEvent("click", {
          clientX: SPOT.left + 5,
          clientY: SPOT.top + 5,
          bubbles: true,
        }),
      );
    });
    expect(picks).toEqual(["t1"]);
  });

  it("本文が先に片付いても、層の後片付けで落ちない", () => {
    // 印の層を本文の入れ物へ直に portal すると、ファイルを切り替えたときに
    // 「親が先、層が後」の順になり、removeChild が行き先を見失って落ちる。
    // 層の入れ物を自分で持てば、親が先に消えても片付けは空振りで済む。
    vi.useFakeTimers();
    open();
    content!.replaceChildren();
    expect(() =>
      act(() => {
        root?.unmount();
        root = null;
      }),
    ).not.toThrow();
  });

  it("人の書き込みは書き直さず、一覧で開く", () => {
    vi.useFakeTimers();
    open(false);
    hover();
    const box = card();
    expect(box!.textContent).toContain("クリックで開く");
    press(box!);
    expect(picks).toEqual(["t1"]);
    expect(document.querySelector(".mg-review-peek textarea")).toBeNull();
  });
});

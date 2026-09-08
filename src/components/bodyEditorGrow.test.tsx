// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BodyEditor } from "./BodyEditor";

// 編集面は段階的に組む（先頭の 40 ブロックで作って焦点を当て、残りを後から
// 足す）。ここで押さえるのは**育ち切る前に書き出さないこと**。
//
// 途中の doc を直列化するとファイルが切り詰められる。実測では捕まえられない
// （運よく育ち切ってから保存が走ることがある）ので、試験で止める。

// 段階が分かれる量にする。40 では 1 度で組み上がってしまう。
const BLOCKS = 140;
const body = Array.from(
  { length: BLOCKS },
  (_, i) => `段落 ${i} です。番号は ${i}。`,
).join("\n\n");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  // jsdom は描画を持たないので、測る道具だけ足しておく。
  const noRects = () => [] as unknown as DOMRectList;
  const noRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    }) as DOMRect;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = noRects;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
  if (!Range.prototype.getBoundingClientRect)
    Range.prototype.getBoundingClientRect = noRect;
  // カーソルの点滅は頭出しにアニメーションの巻き戻しを使う。jsdom には無い。
  if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => [];
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const kids = (at: HTMLElement) => at.querySelectorAll(".mg-pm > *").length;

// 育て終わるまでフレームを回す。1 回に足す量は測って寄せるので、回数の上限
// だけ決めて「増えなくなったら終わり」で見る。
async function grow(at: HTMLElement): Promise<void> {
  let same = 0;
  for (let i = 0; i < 200 && same < 3; i++) {
    const before = kids(at);
    await act(async () => {
      await new Promise((done) => requestAnimationFrame(() => done(null)));
    });
    same = kids(at) === before ? same + 1 : 0;
  }
}

describe("編集面を段階的に組む", () => {
  const editor = (
    props: Partial<React.ComponentProps<typeof BodyEditor>> = {},
  ) =>
    mount(
      <BodyEditor
        body={body}
        prefix=""
        dark={false}
        className="mg-prose prose"
        onChange={() => {}}
        onSave={() => {}}
        {...props}
      />,
    );

  it("最初は先頭だけ入れ、後から全部に育つ", async () => {
    const at = editor();
    const first = kids(at);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(BLOCKS);

    await grow(at);
    expect(kids(at)).toBe(BLOCKS);
  });

  it("育ち中は書き出さない。育ち切った後は元の本文と一致する", async () => {
    const wrote: string[] = [];
    const flush: { current: (() => void) | null } = { current: null };
    const at = editor({ onChange: (next) => wrote.push(next), flushRef: flush });

    // 育ち中に ⌘S 相当を頼んでも書き出さない。切り詰めた本文が出たら
    // ファイルが壊れる。
    expect(kids(at)).toBeLessThan(BLOCKS);
    act(() => flush.current?.());
    expect(wrote).toEqual([]);

    await grow(at);
    // 育ち切ってから頼めば、元の本文がそのまま出る。
    act(() => flush.current?.());
    expect(wrote).toEqual([body]);
  });

  it("育ち中でも編集できる（待たされない）", () => {
    const at = editor();
    expect(kids(at)).toBeLessThan(BLOCKS);
    expect(at.querySelector(".mg-pm")?.getAttribute("contenteditable")).toBe(
      "true",
    );
  });

  it("小さい本文は一度で組み上がり、はじめから編集できる", () => {
    const at = editor({ body: "みじかい本文\n" });
    expect(kids(at)).toBe(1);
    expect(at.querySelector(".mg-pm")?.getAttribute("contenteditable")).toBe(
      "true",
    );
  });
});

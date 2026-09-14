// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Emoji } from "../lib/emoji";

// 絵文字の盤の打鍵。開いた時点で 1 つ目に当たりが付き、矢印で動いて Enter で
// 決まる。実データは 700KB あるので、並びだけの当て木に差し替える。

const FAKE: Emoji[] = Array.from({ length: 24 }, (_, i) => ({
  char: String.fromCodePoint(0x1f600 + i),
  label: `顔${i}`,
  tags: [],
  codes: [`face${i}`],
  group: 0,
  order: i,
}));

vi.mock("../lib/emoji", async (orig) => {
  const real = await orig<typeof import("../lib/emoji")>();
  return {
    ...real,
    loadEmoji: () => Promise.resolve(FAKE),
    emojiReady: () => FAKE,
    recentEmoji: () => [],
    rememberEmoji: () => {},
  };
});

const { EmojiBoard } = await import("./EmojiBoard");
const { COLS } = await import("../lib/emoji");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function board(props: Partial<Parameters<typeof EmojiBoard>[0]> = {}) {
  const picked: string[] = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <EmojiBoard
        x={0}
        y={0}
        onPick={(char) => picked.push(char)}
        onClose={() => {}}
        {...props}
      />,
    );
  });
  return { picked };
}

const cells = () => [...document.querySelectorAll<HTMLElement>(".mg-ico-grid button")];
const onAt = () => cells().findIndex((el) => el.classList.contains("is-on"));
const field = () => document.querySelector<HTMLInputElement>(".mg-ico-input")!;

function press(key: string) {
  act(() => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function type(text: string) {
  const el = field();
  act(() => {
    // React の管理下にある値を書き換える。
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("絵文字の盤の打鍵", () => {
  it("開いた時点で 1 つ目に当たりが付く", () => {
    board();
    expect(onAt()).toBe(0);
  });

  it("右で次へ、左で前へ", () => {
    board();
    press("ArrowRight");
    expect(onAt()).toBe(1);
    press("ArrowRight");
    expect(onAt()).toBe(2);
    press("ArrowLeft");
    expect(onAt()).toBe(1);
  });

  it("下は 1 列ぶん進む", () => {
    board();
    press("ArrowDown");
    expect(onAt()).toBe(COLS);
    press("ArrowUp");
    expect(onAt()).toBe(0);
  });

  it("端より先へは行かない", () => {
    board();
    press("ArrowLeft");
    expect(onAt()).toBe(0);
    for (let i = 0; i < 40; i++) press("ArrowRight");
    expect(onAt()).toBe(FAKE.length - 1);
  });

  it("Enter で当たっているものが返る", () => {
    const { picked } = board();
    press("ArrowRight");
    press("Enter");
    expect(picked).toEqual([FAKE[1].char]);
  });

  it("探し直すと当たりが先頭へ戻る", () => {
    board();
    press("ArrowDown");
    expect(onAt()).toBe(COLS);
    type("face1");
    expect(onAt()).toBe(0);
  });

  it("呼び出し側が番号を持つときは、そちらが当たる", () => {
    board({ query: "face", active: 2 });
    expect(onAt()).toBe(2);
  });
});

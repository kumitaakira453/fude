// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FrontmatterFields } from "./FrontmatterFields";

// 書くときのフロントマター。値は素の contenteditable に置いてあり、React は
// 中身を持たない。ここで押さえるのは「打っても塗り直されないこと」と
// 「本文との行き来」。

const FM = ["---", "title: 題", "種別: 新規依頼", "依頼日: '2026-09-02'", "---", ""].join(
  "\n",
);

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

interface Rig {
  cells: () => HTMLElement[];
  wrote: string[];
  out: () => number;
  enter: { current: (() => void) | null };
  again: (fm: string) => void;
}

function rig(fm = FM): Rig {
  const wrote: string[] = [];
  let left = 0;
  const enter: { current: (() => void) | null } = { current: null };

  const made = (text: string) => (
    <FrontmatterFields
      fm={text}
      onChange={(next) => wrote.push(next)}
      onOut={() => left++}
      enterRef={enter}
    />
  );

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(made(fm)));

  return {
    cells: () => [...host!.querySelectorAll<HTMLElement>(".mg-fm-cell")],
    wrote,
    out: () => left,
    enter,
    again: (text) => act(() => root!.render(made(text))),
  };
}

// 欄に打つ。素の contenteditable なので、DOM を書いてから合図を出す。
function type(el: HTMLElement, text: string) {
  el.textContent = text;
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// 焦点が外れたとき（保存を待たずに流す）。
function leave(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

const key = (el: HTMLElement, k: string, shift = false) =>
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true }),
    );
  });

describe("書くときのフロントマター", () => {
  it("値ごとに欄が出て、題が先に来る", () => {
    const r = rig();
    expect(r.cells().map((el) => el.textContent)).toEqual([
      "題",
      "新規依頼",
      "2026-09-02",
    ]);
  });

  it("打つと、その値の行だけが変わった生テキストが届く", () => {
    const r = rig();
    type(r.cells()[1], "修正依頼");
    leave(r.cells()[1]);
    expect(r.wrote.at(-1)).toBe(
      ["---", "title: 題", "種別: 修正依頼", "依頼日: '2026-09-02'", "---", ""].join(
        "\n",
      ),
    );
  });

  it("続けて打っても範囲がずれない", () => {
    const r = rig();
    type(r.cells()[1], "ずっと長い種別の名前");
    type(r.cells()[2], "2026-12-31");
    leave(r.cells()[2]);
    expect(r.wrote.at(-1)).toBe(
      [
        "---",
        "title: 題",
        "種別: ずっと長い種別の名前",
        "依頼日: '2026-12-31'",
        "---",
        "",
      ].join("\n"),
    );
  });

  it("引用符付きの値は引用符のまま保たれる", () => {
    const r = rig();
    type(r.cells()[2], "2026-12-31");
    leave(r.cells()[2]);
    expect(r.wrote.at(-1)).toContain("依頼日: '2026-12-31'");
  });

  it("打っている最中は、外からの描き直しで欄が戻らない", () => {
    const r = rig();
    const cell = r.cells()[1];
    cell.focus();
    type(cell, "打ちかけ");
    // 外の変更が届いても、焦点のある欄には触らない。
    r.again(FM.replace("種別: 新規依頼", "種別: 外で変えた"));
    expect(r.cells()[1].textContent).toBe("打ちかけ");
  });

  it("焦点が無いときは外の変更を取り込む", () => {
    const r = rig();
    r.again(FM.replace("種別: 新規依頼", "種別: 外で変えた"));
    expect(r.cells()[1].textContent).toBe("外で変えた");
  });
});

describe("欄と本文の行き来", () => {
  it("Tab で次の欄、Shift-Tab で前の欄へ", () => {
    const r = rig();
    r.cells()[0].focus();
    key(r.cells()[0], "Tab");
    expect(document.activeElement).toBe(r.cells()[1]);
    key(r.cells()[1], "Tab", true);
    expect(document.activeElement).toBe(r.cells()[0]);
  });

  it("最後の欄で ↓ を押すと本文へ抜ける", () => {
    const r = rig();
    const last = r.cells()[2];
    last.focus();
    key(last, "ArrowDown");
    expect(r.out()).toBe(1);
  });

  it("途中の欄の ↓ は次の欄へ。本文へは抜けない", () => {
    const r = rig();
    r.cells()[0].focus();
    key(r.cells()[0], "ArrowDown");
    expect(document.activeElement).toBe(r.cells()[1]);
    expect(r.out()).toBe(0);
  });

  it("最初の欄の ↑ では何も起きない", () => {
    const r = rig();
    r.cells()[0].focus();
    key(r.cells()[0], "ArrowUp");
    expect(document.activeElement).toBe(r.cells()[0]);
    expect(r.out()).toBe(0);
  });

  it("Esc で本文へ戻る", () => {
    const r = rig();
    r.cells()[1].focus();
    key(r.cells()[1], "Escape");
    expect(r.out()).toBe(1);
  });

  it("本文から戻ってくると、末尾の欄に入る", () => {
    const r = rig();
    act(() => r.enter.current?.());
    expect(document.activeElement).toBe(r.cells()[2]);
  });
});

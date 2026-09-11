// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EditorView } from "prosemirror-view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BodyEditor, type Editing } from "./BodyEditor";

// 編集面が受け取る prefix（フロントマター）と body（本文）の境目。
//
// 編集面の文書は本文しか持たず、書き出すときに prefix を頭へ付け直す。
// 境目を取り違えると、フロントマターが巻き戻ったり二重になったりする。

const FM_A = "---\ntitle: あ\n---\n";
const FM_B = "---\ntitle: い\n---\n";
const BODY = "みじかい本文\n";

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

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

interface Rig {
  at: HTMLElement;
  wrote: string[];
  flush: { current: (() => void) | null };
  adopt: { current: ((text: string) => void) | null };
  view: () => EditorView;
  again: (prefix: string) => void;
  kids: () => number;
}

function rig(prefix: string): Rig {
  const wrote: string[] = [];
  const flush: { current: (() => void) | null } = { current: null };
  const adopt: { current: ((text: string) => void) | null } = { current: null };
  let editing: Editing | null = null;

  const made = (fm: string) => (
    <BodyEditor
      body={BODY}
      prefix={fm}
      dark={false}
      className="mg-prose prose"
      onChange={(next) => wrote.push(next)}
      onSave={() => {}}
      onBuilt={(built) => {
        editing = built;
      }}
      flushRef={flush}
      adoptRef={adopt}
    />
  );

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(made(prefix)));

  const at = host;
  return {
    at,
    wrote,
    flush,
    adopt,
    view: () => (editing as Editing | null)!.view,
    again: (fm) => act(() => root!.render(made(fm))),
    kids: () => at.querySelectorAll(".mg-pm > *").length,
  };
}

// 本文の末尾に一字足す。書き出しの合図を出すための最小の変更。
const typeIn = (r: Rig) => {
  const view = r.view();
  act(() => {
    view.dispatch(view.state.tr.insertText("！", view.state.doc.content.size - 1));
  });
  act(() => r.flush.current?.());
};

describe("フロントマターと本文の境目", () => {
  it("フロントマターが差し替わったら、書き出しも新しいものになる", () => {
    const r = rig(FM_A);
    r.again(FM_B);
    typeIn(r);
    const last = r.wrote.at(-1)!;
    expect(last.startsWith(FM_B)).toBe(true);
    expect(last).not.toContain("title: あ");
  });

  it("差し替えが無ければ元のフロントマターのまま書き出す", () => {
    const r = rig(FM_A);
    typeIn(r);
    expect(r.wrote.at(-1)!.startsWith(FM_A)).toBe(true);
  });

  it("外からの取り込みには本文だけを渡す。渡し間違えると二重になる", () => {
    const r = rig(FM_A);
    const one = r.kids();

    // 正しい渡し方。文書は本文のままで、書き出しも一組で済む。
    act(() => r.adopt.current?.("直した本文\n"));
    expect(r.kids()).toBe(one);
    typeIn(r);
    expect(r.wrote.at(-1)!.startsWith(FM_A)).toBe(true);
    expect(r.wrote.at(-1)!.match(/title: あ/g)!.length).toBe(1);

    // 全文を渡すと、フロントマターが本文の節点として入ってしまう。
    act(() => r.adopt.current?.(FM_A + "直した本文\n"));
    expect(r.kids()).toBeGreaterThan(one);
    typeIn(r);
    expect(r.wrote.at(-1)!.match(/title: あ/g)!.length).toBe(2);
  });
});

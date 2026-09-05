// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BodyEditor } from "./BodyEditor";
import { CalloutIcon } from "./CalloutIcon";
import { Markdown } from "./Markdown";

// 囲みのアイコンを押してから盤が出るところまでを、読むときと編集面の両方で見る。

// 実データの形。属性の並びと色まで同じにする。
const CALLOUT = [
  '<callout icon="⚠️" color="gray_bg">',
  "",
  "気をつけること",
  "",
  "</callout>",
  "",
].join("\n");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom は描画を持たないので、測る道具だけ足しておく。
  const noRects = () => [] as unknown as DOMRectList;
  const noRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = noRects;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = noRect;
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
  document.querySelectorAll(".mg-ico-pick").forEach((el) => el.remove());
  root = null;
  host = null;
});

const board = () => document.querySelector(".mg-ico-pick");

// 押下を配る。盤は click で出し、閉じるのは mousedown を見ているので、
// どちらを配ったかで結果が変わる。
const send = (el: Element, type: string) =>
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  });

describe("編集面", () => {
  const editor = () =>
    mount(
      <BodyEditor
        body={CALLOUT}
        prefix=""
        dark={false}
        className="mg-prose prose"
        onChange={() => {}}
        onSave={() => {}}
      />,
    );

  it("実データの形でアイコンが出る", () => {
    const at = editor();
    const ico = at.querySelector(".mg-callout-ico");
    expect(ico?.textContent).toBe("⚠️");
    expect(ico?.getAttribute("contenteditable")).toBe("false");
    expect(at.querySelector(".mg-callout")?.getAttribute("data-color")).toBe("gray_bg");
  });

  // 盤を mousedown で出すと、盤が付ける「外を押したら閉じる」（mousedown を
  // 見ている）が、まだ配り終えていないその押下を受け取って即座に閉じる。
  it("盤が出るのは押し下げではなく押下の完了", () => {
    const at = editor();
    const ico = at.querySelector(".mg-callout-ico")!;

    send(ico, "mousedown");
    expect(board()).toBeNull();

    send(ico, "click");
    expect(board()).not.toBeNull();
  });

  it("盤から選ぶとアイコンが差し替わる", () => {
    const at = editor();
    const ico = at.querySelector(".mg-callout-ico")!;
    send(ico, "mousedown");
    send(ico, "click");

    const pick = [...board()!.querySelectorAll(".mg-ico-grid > button")].find(
      (b) => b.textContent === "✅",
    );
    expect(pick).toBeDefined();
    send(pick!, "click");

    expect(board()).toBeNull();
    expect(at.querySelector(".mg-callout-ico")?.textContent).toBe("✅");
  });

  it("外すと属性ごと落ちる", () => {
    const at = editor();
    const ico = at.querySelector(".mg-callout-ico")!;
    send(ico, "mousedown");
    send(ico, "click");

    send(board()!.querySelector(".mg-ico-head > button")!, "click");
    expect(at.querySelector(".mg-callout-ico")?.textContent).toBe("");
  });
});

describe("読むとき", () => {
  it("印が出ていて、押すとその塊の番号で盤が出る", () => {
    const picked: [number, string][] = [];
    const at = mount(
      <div className="mg-prose">
        <div className="mg-block" data-mg-block="3">
          <Markdown body={CALLOUT} editorial />
        </div>
      </div>,
    );

    const ico = at.querySelector("[data-mg-callout-ico]");
    expect(ico).not.toBeNull();
    expect(ico?.classList.contains("mg-callout-ico")).toBe(true);
    expect(ico?.textContent).toBe("⚠️");

    // 拾う側は本文の入れ物に付ける。描いた後に付け直す。
    const content = at.querySelector<HTMLElement>(".mg-prose") ?? at;
    act(() => {
      root!.render(
        <>
          <div className="mg-prose">
            <div className="mg-block" data-mg-block="3">
              <Markdown body={CALLOUT} editorial />
            </div>
          </div>
          <CalloutIcon
            content={content}
            contentKey="probe"
            onPick={(index, icon) => picked.push([index, icon])}
          />
        </>,
      );
    });

    send(at.querySelector("[data-mg-callout-ico]")!, "click");
    expect(board()).not.toBeNull();

    send(
      [...board()!.querySelectorAll(".mg-ico-grid > button")].find(
        (b) => b.textContent === "✅",
      )!,
      "click",
    );
    expect(picked).toEqual([[3, "✅"]]);
  });
});

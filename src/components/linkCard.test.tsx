// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BodyEditor } from "./BodyEditor";

// リンクを指したときに出す札と、そこからの打ち直し。
//
// 帯は文字を選んでから出るので、リンクそのものを相手にできなかった。指した
// リンクを相手にする道が要る。

const BODY = "ここに [埋め込みリンク](https://demia.co.jp/about_us) があります。\n";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const noRects = () => [] as unknown as DOMRectList;
  const noRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = noRects;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = noRect;
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
const wrote: string[] = [];
const flush: { current: (() => void) | null } = { current: null };

function editor() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <BodyEditor
        body={BODY}
        prefix=""
        dark={false}
        className="mg-prose prose"
        onChange={(next) => wrote.push(next)}
        onSave={() => {}}
        flushRef={flush}
      />,
    ),
  );
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll(".mg-link-card, .mg-ask").forEach((el) => el.remove());
  wrote.length = 0;
  root = null;
  host = null;
});

const card = () => document.querySelector<HTMLElement>(".mg-link-card");
const field = () => document.querySelector<HTMLInputElement>(".mg-ask input");

// 指す。見張りは 1 フレームに 1 回なので、1 枚待つ。
async function point(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    await new Promise((done) => requestAnimationFrame(() => done(null)));
  });
}

// 手を動かす。消すかどうかは位置で決まるので、座標だけ配る。
async function moveMouse(x: number, y: number) {
  await act(async () => {
    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }),
    );
    await new Promise((done) => requestAnimationFrame(() => done(null)));
  });
}

function press(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
}

const nativeValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;

function fill(text: string) {
  const el = field()!;
  act(() => {
    nativeValue.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
}

const saved = (): string => {
  act(() => flush.current?.());
  return wrote.at(-1) ?? "";
};

const button = (label: string): HTMLElement => {
  const el = [...document.querySelectorAll<HTMLElement>(".mg-link-card button")].find(
    (b) => b.textContent?.includes(label) || b.getAttribute("aria-label") === label,
  );
  expect(el, `${label} が無い`).toBeDefined();
  return el!;
};

describe("リンクの札", () => {
  it("指すと行き先が出る", async () => {
    const at = editor();
    expect(card()).toBeNull();
    await point(at.querySelector("a")!);
    expect(card()?.textContent).toContain("https://demia.co.jp/about_us");
  });

  it("編集から行き先を打ち直せる", async () => {
    const at = editor();
    await point(at.querySelector("a")!);
    press(button("編集"));
    expect(field()?.value).toBe("https://demia.co.jp/about_us");
    fill("https://demia.co.jp/news");
    expect(saved()).toBe(
      "ここに [埋め込みリンク](https://demia.co.jp/news) があります。\n",
    );
  });

  it("打ち直しているあいだ、そのリンクに印が付く", async () => {
    const at = editor();
    await point(at.querySelector("a")!);
    expect(at.querySelector(".mg-editing")).toBeNull();
    press(button("編集"));
    expect(at.querySelector(".mg-editing")?.textContent).toBe("埋め込みリンク");
    fill("https://demia.co.jp/news");
    expect(at.querySelector(".mg-editing")).toBeNull();
  });

  it("行き先を空にするとリンクが外れる", async () => {
    const at = editor();
    await point(at.querySelector("a")!);
    press(button("編集"));
    fill("");
    expect(saved()).toBe("ここに 埋め込みリンク があります。\n");
  });

  // 出し消しは手の位置で決める。入った・出たの通知に任せると、札は本文の外に
  // 置いてあるぶん順番が絡んで、手を運んだ途端に消える。
  it("札の上に手があるあいだは消えない", async () => {
    const at = editor();
    await point(at.querySelector("a")!);
    expect(card()).not.toBeNull();
    // 札の上（jsdom では矩形が 0 なので原点）。
    await moveMouse(0, 0);
    expect(card()).not.toBeNull();
  });

  it("リンクからも札からも離れると消える", async () => {
    const at = editor();
    await point(at.querySelector("a")!);
    expect(card()).not.toBeNull();
    await moveMouse(900, 700);
    expect(card()).toBeNull();
  });
});

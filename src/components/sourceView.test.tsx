// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SourceView } from "./SourceView";

// 原文の面。長いファイルを一息に組むと出るまで固まるので、最初の分だけを
// 出してからフレームごとに伸ばす。

// 待っているフレーム。伸ばす合図は requestAnimationFrame に載るので、
// 進めたいときだけ手で回す。
let pending: FrameRequestCallback[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = ((f: FrameRequestCallback) => {
    pending.push(f);
    return pending.length;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
});

// フレームを 1 回ぶん進める。
function frame() {
  act(() => {
    const waiting = pending;
    pending = [];
    waiting.forEach((f) => f(0));
  });
}

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function show(code: string, lang: string | null = null) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<SourceView code={code} lang={lang} />);
  });
}

const rows = () => document.querySelectorAll(".mg-source-line").length;

describe("原文の面", () => {
  it("短いファイルはそのまま全部出る", () => {
    show("あ\nい\nう");
    expect(rows()).toBe(3);
  });

  it("行番号は節点として置かない", () => {
    // 数え上げ（counter）で描く。節点として置くと、本文を選んだときに一緒に
    // 選ばれて写した中身に混ざる。
    show("あ\nい");
    expect(document.querySelector(".mg-source")?.textContent).toBe("あい");
  });

  it("長いファイルは最初の分だけ出て、フレームごとに伸びる", () => {
    const long = Array.from({ length: 5_000 }, (_, i) => `行 ${i}`).join("\n");
    show(long);
    const first = rows();
    expect(first).toBeLessThan(5_000);
    frame();
    expect(rows()).toBeGreaterThan(first);
  });

  it("伸びきれば全部出る", () => {
    const long = Array.from({ length: 3_000 }, (_, i) => `行 ${i}`).join("\n");
    show(long);
    for (let i = 0; i < 5; i++) frame();
    expect(rows()).toBe(3_000);
  });
});

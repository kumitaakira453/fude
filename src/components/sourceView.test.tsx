// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SourceView } from "./SourceView";

// 原文の面。長いファイルを全部組むと出るまで固まり、送るのにも描画が
// 追いつかないので、見えている行とその前後だけを組む。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

// 送る枠。jsdom は大きさを測らないので、枠の高さと送った量は手で決める。
function show(code: string, lang: string | null = null) {
  host = document.createElement("div");
  host.style.overflowY = "auto";
  Object.defineProperty(host, "clientHeight", { value: 420 });
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

  it("長いファイルは見えている分とその前後だけを組み、残りは空きの高さで持つ", () => {
    const long = Array.from({ length: 5_000 }, (_, i) => `行 ${i}`).join("\n");
    show(long);
    expect(rows()).toBeLessThan(200);
    const box = document.querySelector<HTMLElement>(".mg-source")!;
    const gap = box.lastElementChild as HTMLElement;
    expect(parseInt(gap.style.height)).toBe((5_000 - rows()) * 21);
  });

  it("送ると、組む行がその位置へ移り、行番号もそこから数える", () => {
    const long = Array.from({ length: 5_000 }, (_, i) => `行 ${i}`).join("\n");
    show(long);
    // 送った量と、送ったぶん上へずれた面の位置（本物の窓では配置から決まる）。
    let scrolled = 0;
    Object.defineProperty(host!, "scrollTop", { get: () => scrolled });
    document.querySelector<HTMLElement>(".mg-source")!.getBoundingClientRect = () =>
      ({ top: -scrolled }) as DOMRect;
    act(() => {
      scrolled = 21 * 3_000;
      host!.dispatchEvent(new Event("scroll"));
    });
    const texts = [...document.querySelectorAll(".mg-source-line")].map((l) => l.textContent);
    expect(texts).toContain("行 3000");
    expect(texts).not.toContain("行 0");
    const box = document.querySelector<HTMLElement>(".mg-source")!;
    const start = Number(texts[0]!.replace("行 ", ""));
    expect(box.style.counterReset).toBe(`mg-line ${start}`);
  });
});

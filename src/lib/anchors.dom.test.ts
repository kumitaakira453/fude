// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { landOn } from "./anchors";

// 節へ寄せるところ。本文は先頭から順に描かれるので、押した時点では行き先が
// まだ DOM に無い。出てくるまで待てること、出てこなければ知らせることを見る。

let frames: FrameRequestCallback[] = [];
const tick = () => {
  const run = frames;
  frames = [];
  for (const f of run) f(0);
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    frames.push(f);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  Element.prototype.scrollIntoView = vi.fn();
  // 時計は setTimeout だけ差し替える。フレームはこちらで 1 枚ずつ進める。
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function paper(html: string): HTMLElement {
  const el = document.createElement("article");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("landOn", () => {
  it("その見出しへ寄せて、しばらく目立たせる", () => {
    const el = paper('<h2 id="やり取り">やり取り</h2>');
    landOn(el, "やり取り");
    const head = el.querySelector("h2")!;
    expect(head.scrollIntoView).toHaveBeenCalled();
    expect(head.classList.contains("mg-landed")).toBe(true);
    vi.advanceTimersByTime(1300);
    expect(head.classList.contains("mg-landed")).toBe(false);
  });

  it("まだ描かれていなければ、出てくるまで待つ", () => {
    const el = paper("<p>本文</p>");
    const miss = vi.fn();
    landOn(el, "版", miss);
    expect(miss).not.toHaveBeenCalled();

    tick();
    el.insertAdjacentHTML("beforeend", '<h2 id="版">版</h2>');
    tick();
    expect(el.querySelector("h2")!.classList.contains("mg-landed")).toBe(true);
    expect(miss).not.toHaveBeenCalled();
  });

  it("いつまでも出てこなければ、見つからなかったと知らせる", () => {
    const el = paper("<p>本文</p>");
    const miss = vi.fn();
    landOn(el, "無い見出し", miss);
    for (let i = 0; i < 50; i++) tick();
    expect(miss).toHaveBeenCalledTimes(1);
  });

  it("やめたら、そのあとのフレームでは動かない", () => {
    const el = paper("<p>本文</p>");
    const miss = vi.fn();
    const stop = landOn(el, "版", miss);
    stop();
    el.insertAdjacentHTML("beforeend", '<h2 id="版">版</h2>');
    for (let i = 0; i < 50; i++) tick();
    expect(el.querySelector("h2")!.classList.contains("mg-landed")).toBe(false);
    expect(miss).not.toHaveBeenCalled();
  });
});

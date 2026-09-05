import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { throttled } from "./later";

describe("間を置いて流す", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("連打しても手を止めるまで流さない", () => {
    const ran = vi.fn();
    const ask = throttled(ran, 500, 3000);
    for (let i = 0; i < 10; i++) {
      ask();
      vi.advanceTimersByTime(50);
    }
    expect(ran).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it("打ち続けても上限で必ず流れる", () => {
    const ran = vi.fn();
    const ask = throttled(ran, 500, 3000);
    // 100ms ごとに 40 回（4 秒ぶん）。手は一度も止まらない。
    for (let i = 0; i < 40; i++) {
      ask();
      vi.advanceTimersByTime(100);
    }
    expect(ran).toHaveBeenCalled();
    // 上限は 3 秒なので、4 秒のあいだに 1 回以上は流れている。
    expect(ran.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("流したあとは数え直す", () => {
    const ran = vi.fn();
    const ask = throttled(ran, 500, 3000);
    ask();
    vi.advanceTimersByTime(500);
    expect(ran).toHaveBeenCalledTimes(1);
    ask();
    vi.advanceTimersByTime(499);
    expect(ran).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(ran).toHaveBeenCalledTimes(2);
  });

  it("flush で待たずに流れる", () => {
    const ran = vi.fn();
    const ask = throttled(ran, 500, 3000);
    ask();
    expect(ask.pending()).toBe(true);
    ask.flush();
    expect(ran).toHaveBeenCalledTimes(1);
    expect(ask.pending()).toBe(false);
    // 予約が無ければ何もしない
    ask.flush();
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it("cancel すると流れない", () => {
    const ran = vi.fn();
    const ask = throttled(ran, 500, 3000);
    ask();
    ask.cancel();
    vi.advanceTimersByTime(5000);
    expect(ran).not.toHaveBeenCalled();
  });
});

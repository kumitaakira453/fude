// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { holdRow, trimSlack } from "./keepRow";

// 開閉した行を画面の同じ高さに残す。jsdom は位置を測れないので、スクロールする箱と
// 行を当て木で作る。箱の中身の高さは content + 空き（slack）で、行の位置は
// 一覧の中の位置 − scrollTop で決まる。

function rig(opts: { content: number; view: number; scrollTop: number; rowAt: number }) {
  const slack = document.createElement("div");
  let content = opts.content;
  let scrollTop = opts.scrollTop;
  const height = () => content + (parseFloat(slack.style.height) || 0);
  const scroller = document.createElement("div");
  Object.defineProperties(scroller, {
    scrollHeight: { get: height },
    clientHeight: { value: opts.view },
    scrollTop: {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = Math.min(Math.max(0, v), height() - opts.view);
      },
    },
  });
  scroller.getBoundingClientRect = () => new DOMRect(0, 0, 200, opts.view);
  let rowAt = opts.rowAt;
  const row = document.createElement("div");
  row.getBoundingClientRect = () => new DOMRect(0, rowAt - scrollTop, 200, 26);
  return {
    scroller,
    row,
    slack,
    // 描き直しを真似る。中身が縮むと、ブラウザは scrollTop を下端に収める。
    redraw(next: { content?: number; rowAt?: number }) {
      content = next.content ?? content;
      rowAt = next.rowAt ?? rowAt;
      scroller.scrollTop = scrollTop;
    },
    get top() {
      return rowAt - scrollTop;
    },
  };
}

describe("開閉した行を同じ高さに残す", () => {
  it("下のほうで閉じて一覧が縮んでも、押した行は同じ高さに残り、足りない分は空きで作る", () => {
    // 1000 の一覧を 400 の窓で下端（600）まで送り、800 の所の行を押す。
    const t = rig({ content: 1000, view: 400, scrollTop: 600, rowAt: 800 });
    const before = t.top;
    // 閉じて中身が 700 に縮み、scrollTop は 300 へ引き戻される。
    t.redraw({ content: 700 });
    expect(t.top).not.toBe(before);
    holdRow(t.scroller, t.row, before, t.slack);
    expect(t.top).toBe(before);
    expect(parseFloat(t.slack.style.height)).toBe(300);
  });

  it("上端に貼り付いた見出しを閉じて見出しが本来の位置へ戻っても、元の高さへ送り戻す", () => {
    const t = rig({ content: 2000, view: 400, scrollTop: 500, rowAt: 500 });
    t.redraw({ rowAt: 100 });
    holdRow(t.scroller, t.row, 0, t.slack);
    expect(t.top).toBe(0);
    expect(t.slack.style.height).toBe("");
  });

  it("ずれていなければ何もしない", () => {
    const t = rig({ content: 2000, view: 400, scrollTop: 100, rowAt: 300 });
    holdRow(t.scroller, t.row, t.top, t.slack);
    expect(t.top).toBe(200);
    expect(t.slack.style.height).toBe("");
  });

  it("上へ送ると、見えなくなった分の空きを縮める", () => {
    const t = rig({ content: 1000, view: 400, scrollTop: 600, rowAt: 800 });
    const before = t.top;
    t.redraw({ content: 700 });
    holdRow(t.scroller, t.row, before, t.slack);
    t.scroller.scrollTop = 450;
    trimSlack(t.scroller, t.slack);
    expect(parseFloat(t.slack.style.height)).toBe(150);
    t.scroller.scrollTop = 100;
    trimSlack(t.scroller, t.slack);
    expect(parseFloat(t.slack.style.height)).toBe(0);
  });
});

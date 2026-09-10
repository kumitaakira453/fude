import { describe, expect, it } from "vitest";
import { CONTEXT, lineDiff, splitRows, type DiffLine } from "./lineDiff";

// 1 行を「種類 旧番号/新番号 本文」で見比べられる形にする。
const shape = (lines: DiffLine[]) =>
  lines.map((l) => `${l.kind} ${l.a ?? "-"}/${l.b ?? "-"} ${l.text}`);

const lines = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `行 ${i + from}`).join("\n") + "\n";

describe("行単位の差分", () => {
  it("追加した行を数え、番号を振る", () => {
    const d = lineDiff("あ\nい\n", "あ\nい\nう\n");
    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
    expect(shape(d.hunks[0].lines)).toEqual([
      "same 1/1 あ",
      "same 2/2 い",
      "add -/3 う",
    ]);
  });

  it("削除した行を数える", () => {
    const d = lineDiff("あ\nい\nう\n", "あ\nう\n");
    expect(d.removed).toBe(1);
    expect(shape(d.hunks[0].lines)).toEqual([
      "same 1/1 あ",
      "del 2/- い",
      "same 3/2 う",
    ]);
  });

  it("書き換えた行は消えた行と入った行の組にする", () => {
    const d = lineDiff("あ\nい\n", "あ\nいい\n");
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    const [, del, add] = d.hunks[0].lines;
    expect(del.kind).toBe("del");
    expect(add.kind).toBe("add");
    // 同じ切れ目のものは同じ組。行内のどこが変わったかを示すのに使う
    expect(del.pair).toBe(add.pair);
    expect(del.pair).toBe(0);
  });

  it("末尾の改行で空行が増えない", () => {
    expect(lineDiff("あ\n", "あ\n").hunks).toEqual([]);
    expect(lineDiff("", "").hunks).toEqual([]);
  });

  it("変わっていない行は前後だけ残して畳む", () => {
    const before = lines(20);
    const after = before.replace("行 10", "行 10 を直した");
    const d = lineDiff(before, after);
    // 1 つのまとまりに収まり、残るのは前後 CONTEXT 行 + 書き換えの組
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0].lines).toHaveLength(CONTEXT * 2 + 2);
    expect(d.hunks[0].a).toBe(10 - CONTEXT);
  });

  it("離れた変更は別のまとまりになる", () => {
    const before = lines(40);
    const after = before.replace("行 5", "五").replace("行 30", "三十");
    const d = lineDiff(before, after);
    expect(d.hunks).toHaveLength(2);
    expect(d.hunks[0].a).toBe(5 - CONTEXT);
    expect(d.hunks[1].a).toBe(30 - CONTEXT);
  });
});

describe("分割表示の行", () => {
  it("組になっているものは同じ行に並べる", () => {
    const d = lineDiff("あ\nい\n", "あ\nいい\n");
    const rows = splitRows(d.hunks[0].lines);
    expect(rows).toHaveLength(2);
    expect(rows[0].left?.text).toBe("あ");
    expect(rows[0].right?.text).toBe("あ");
    expect(rows[1].left?.text).toBe("い");
    expect(rows[1].right?.text).toBe("いい");
  });

  it("片側だけの行は相手を空ける", () => {
    const rows = splitRows(lineDiff("あ\n", "あ\nう\n").hunks[0].lines);
    expect(rows[1].left).toBeNull();
    expect(rows[1].right?.text).toBe("う");
  });
});

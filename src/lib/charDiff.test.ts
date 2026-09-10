import { describe, expect, it } from "vitest";
import { CHAR_LIMIT, charDiff, type Span } from "./charDiff";

// 区間を、その区間が指す文字で見比べられる形にする。
const cut = (text: string, spans: Span[]) =>
  spans.map((s) => text.slice(s.from, s.to));

describe("文字単位の差分", () => {
  it("言い換えた部分だけを指す", () => {
    const a = "生成AIの利用料金は従来と異なる。";
    const b = "生成AIの利用料金は、従来のSaaSと異なる。";
    const d = charDiff(a, b);
    expect(cut(a, d.del)).toEqual([]);
    expect(cut(b, d.ins)).toEqual(["、", "のSaaS"]);
  });

  it("削除だけのときは変更後に区間が出ない", () => {
    const a = "費用構造が根本的に異なる。";
    const b = "費用構造が異なる。";
    const d = charDiff(a, b);
    expect(cut(a, d.del)).toEqual(["根本的に"]);
    expect(d.ins).toEqual([]);
  });

  it("片方が空なら、もう片方の全体を指す", () => {
    expect(cut("あいう", charDiff("あいう", "").del)).toEqual(["あいう"]);
    expect(charDiff("あいう", "").ins).toEqual([]);
    expect(cut("あいう", charDiff("", "あいう").ins)).toEqual(["あいう"]);
    expect(charDiff("", "あいう").del).toEqual([]);
  });

  it("同じ文には区間が出ない", () => {
    const d = charDiff("変わっていない。", "変わっていない。");
    expect(d.del).toEqual([]);
    expect(d.ins).toEqual([]);
    expect(d.gaveUp).toBe(false);
  });

  it("サロゲートペアを割らない", () => {
    // 絵文字は UTF-16 で 2 文字。区間の境目がその真ん中に来ないこと
    const a = "ヒント 💡 あり";
    const b = "ヒント 🔥 あり";
    const d = charDiff(a, b);
    expect(cut(a, d.del)).toEqual(["💡"]);
    expect(cut(b, d.ins)).toEqual(["🔥"]);
  });

  it("長すぎるときは諦めて全体を指す", () => {
    const a = "あ".repeat(CHAR_LIMIT + 1);
    const b = "い".repeat(CHAR_LIMIT + 1);
    const d = charDiff(a, b);
    expect(d.gaveUp).toBe(true);
    expect(d.del).toEqual([{ from: 0, to: a.length }]);
    expect(d.ins).toEqual([{ from: 0, to: b.length }]);
  });
});

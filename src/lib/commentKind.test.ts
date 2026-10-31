import { describe, expect, it } from "vitest";
import { kindOf, threadKind, withKind } from "./commentKind";

const c = (author: string, body: string) => ({ id: body, author, body, created_at: 0 });

describe("コメントの種類", () => {
  it("頭の印を読み、本文から外す。大文字・全角・空白は区別しない", () => {
    expect(kindOf("[ask] データロスは起き得る？")).toEqual({ kind: "ask", rest: "データロスは起き得る？" });
    expect(kindOf("  ［EDIT］自明なので削除")).toEqual({ kind: "edit", rest: "自明なので削除" });
    expect(kindOf("[ ideas ]いくつか")).toEqual({ kind: "ideas", rest: "いくつか" });
    expect(kindOf("[approve] 案1 で")).toEqual({ kind: "approve", rest: "案1 で" });
  });

  it("4 つ以外の印と印なしは種類として読まず、本文はそのまま", () => {
    expect(kindOf("[仕様調整] 先方に聞く")).toEqual({ kind: null, rest: "[仕様調整] 先方に聞く" });
    expect(kindOf("[R-01] Notion コメント")).toEqual({ kind: null, rest: "[R-01] Notion コメント" });
    expect(kindOf("自明なので削除")).toEqual({ kind: null, rest: "自明なので削除" });
  });

  it("印を書き足す。もとの印は付け替える", () => {
    expect(withKind("ask", "これは？")).toBe("[ask] これは？");
    expect(withKind("edit", "[ask] これは？")).toBe("[edit] これは？");
    expect(withKind(null, "[ask] これは？")).toBe("これは？");
  });

  it("スレッドの種類は、人が最後に付けた種類。AI の返信は見ず、どこにも無ければ修正", () => {
    expect(threadKind({ comments: [c("you", "[ask] 本当？"), c("AI", "[edit] 直しました"), c("you", "なるほど")] })).toBe(
      "ask",
    );
    expect(threadKind({ comments: [c("you", "[ideas] 案を"), c("AI", "案1…"), c("you", "[approve] 案1")] })).toBe(
      "approve",
    );
    expect(threadKind({ comments: [c("you", "削除")] })).toBe("edit");
  });
});

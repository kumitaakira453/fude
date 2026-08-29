import { describe, expect, it } from "vitest";
import { MAIN_LABEL, scopedKey } from "./windows";

describe("scopedKey", () => {
  it("メインウィンドウは今までのキーをそのまま使う", () => {
    // 既に保存されているサイドバーの開閉やレイアウトを引き継ぐため、
    // ここが変わると利用者の設定が初期値に戻ってしまう。
    expect(scopedKey("mdglow:layouts", MAIN_LABEL)).toBe("mdglow:layouts");
    expect(scopedKey("mdglow:sidebar", MAIN_LABEL)).toBe("mdglow:sidebar");
  });

  it("追加ウィンドウは別のキーに分ける", () => {
    expect(scopedKey("mdglow:sidebar", "doc-1")).toBe("mdglow:sidebar:doc-1");
    expect(scopedKey("mdglow:sidebar", "doc-2")).toBe("mdglow:sidebar:doc-2");
  });
});

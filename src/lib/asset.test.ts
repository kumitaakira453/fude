import { describe, expect, it, vi } from "vitest";

// Tauri の変換と同じ形（道筋をまるごと encodeURIComponent する）を置く。
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

const { assetSrc } = await import("./asset");

describe("WebView に読ませる道筋", () => {
  it("区切りの / を残す。相対の道筋が同じ階層に解ける", () => {
    expect(assetSrc("/Users/me/docs/頁.html")).toBe(
      "asset://localhost//Users/me/docs/%E9%A0%81.html?v=0",
    );
  });

  it("名前の中の字は逃がしたまま（空白や記号で切れない）", () => {
    expect(assetSrc("/Users/me/見 本/a b.png")).toBe(
      "asset://localhost//Users/me/%E8%A6%8B%20%E6%9C%AC/a%20b.png?v=0",
    );
  });

  it("版は問い合わせに付く", () => {
    expect(assetSrc("/a/b.pdf", 3).endsWith("?v=3")).toBe(true);
  });
});

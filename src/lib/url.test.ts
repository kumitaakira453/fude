// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { buildHash, parseHash } from "./url";

// 追加ウィンドウの起動 URL はここを経由して復元される。「そのファイルだけの窓」
// の印が往復することを押さえる。

const go = (url: string) => {
  window.history.replaceState(null, "", url);
};

afterEach(() => go("/"));

describe("URL とフォルダ・ファイルの往復", () => {
  it("フォルダとファイルを載せる", () => {
    expect(buildHash("/w", "a/b.md")).toBe("#folder=%2Fw&file=a%2Fb.md");
    go(buildHash("/w", "a/b.md"));
    expect(parseHash()).toEqual({ folderId: "/w", file: "a/b.md", only: false });
  });

  it("そのファイルだけの窓の印を載せる", () => {
    go(buildHash("/w", "a/b.md", true));
    expect(parseHash()).toEqual({ folderId: "/w", file: "a/b.md", only: true });
  });

  it("印は既定では載らない", () => {
    expect(buildHash("/w", "a/b.md")).not.toContain("only");
  });

  it("何も無ければ空のハッシュ", () => {
    expect(buildHash(null, null)).toBe("#");
    go("/");
    expect(parseHash()).toEqual({ folderId: undefined, file: undefined, only: false });
  });

  it("フラグメントが落ちてもクエリから読む", () => {
    go("/index.html?folder=%2Fw&file=a.md&only=1");
    expect(parseHash()).toEqual({ folderId: "/w", file: "a.md", only: true });
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { buildHash, parseHash } from "./url";

// 窓の復元はこのハッシュだけを頼りにする。フォルダの窓と、1 枚だけの窓を
// 取り違えないこと。

const at = (hash: string) => {
  location.hash = hash;
};

beforeEach(() => at(""));

describe("フォルダの窓", () => {
  it("フォルダとファイルが往復する", () => {
    const h = buildHash("/root", "docs/a.md");
    at(h);
    expect(parseHash()).toMatchObject({ folderId: "/root", file: "docs/a.md" });
  });

  it("そのファイルだけの窓の印も往復する", () => {
    at(buildHash("/root", "a.md", true));
    expect(parseHash().only).toBe(true);
  });

  it("何も開いていなければ空になる", () => {
    expect(buildHash(null, null)).toBe("#");
  });
});

describe("1 枚だけの窓", () => {
  it("doc が往復する", () => {
    at(buildHash(null, null, false, "/Users/me/docs/設計.md"));
    expect(parseHash().doc).toBe("/Users/me/docs/設計.md");
  });

  it("doc があればフォルダは載せない（親は履歴に無いので開き直せない）", () => {
    const h = buildHash("/Users/me/docs", "設計.md", false, "/Users/me/docs/設計.md");
    at(h);
    const got = parseHash();
    expect(got.doc).toBe("/Users/me/docs/設計.md");
    expect(got.folderId).toBe(undefined);
    expect(got.file).toBe("設計.md");
  });
});

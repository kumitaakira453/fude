import { describe, expect, it } from "vitest";
import { INDEX_LIMIT, indexable, isSearchable } from "./kind";

// 全文検索の索引に入れるもの。Markdown と字のファイルで、大きすぎる字のファイルは除く。

describe("全文検索の索引に入れるもの", () => {
  it("Markdown と字のファイルは入れ、画像や書庫は入れない", () => {
    expect(isSearchable("a.md")).toBe(true);
    expect(isSearchable("ci.yml")).toBe(true);
    expect(isSearchable("config.json")).toBe(true);
    expect(isSearchable("logo.png")).toBe(false);
    expect(isSearchable("a.zip")).toBe(false);
  });

  it("1 MB を超える字のファイルは読まない（Markdown は大きくても読む）", () => {
    expect(indexable("/w/big.log", INDEX_LIMIT + 1)).toBe(false);
    expect(indexable("/w/ci.yml", 2048)).toBe(true);
    expect(indexable("/w/big.md", INDEX_LIMIT * 4)).toBe(true);
    // 大きさが分からないときは読む。
    expect(indexable("/w/ci.yml", undefined)).toBe(true);
  });
});

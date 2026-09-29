import { describe, expect, it } from "vitest";
import { dropFolderIcons, moveFolderIcons, searchSymbols, SYMBOL_NAMES } from "./folderIcons";

describe("選べるアイコン", () => {
  it("同梱のフォントの名前を並べる", () => {
    expect(SYMBOL_NAMES.length).toBeGreaterThan(3_000);
    expect(SYMBOL_NAMES).toContain("folder");
    expect(SYMBOL_NAMES).toContain("sports_bar");
  });

  it("空白は _ とみなして部分一致で絞る", () => {
    const names = ["beer_bottle", "bottle", "book"];
    expect(searchSymbols("beer bottle", names)).toEqual(["beer_bottle"]);
    expect(searchSymbols("BOTTLE", names)).toEqual(["beer_bottle", "bottle"]);
    expect(searchSymbols("  ", names)).toEqual(names);
  });
});

describe("フォルダが動いたとき", () => {
  const map = { "/w/docs": "book", "/w/docs/img": "image", "/w/docsx": "star", "/w/other": "bolt" };

  it("そのフォルダと下のフォルダを付け替え、似た名前は巻き込まない", () => {
    expect(moveFolderIcons(map, "/w/docs", "/w/archive/docs")).toEqual({
      "/w/archive/docs": "book",
      "/w/archive/docs/img": "image",
      "/w/docsx": "star",
      "/w/other": "bolt",
    });
  });

  it("関わりが無ければ同じ表を返す（描き直しを起こさない）", () => {
    expect(moveFolderIcons(map, "/w/none", "/w/x")).toBe(map);
  });

  it("消したら、そのフォルダと下の分を外す", () => {
    expect(dropFolderIcons(map, "/w/docs")).toEqual({ "/w/docsx": "star", "/w/other": "bolt" });
    expect(dropFolderIcons(map, "/w/none")).toBe(map);
  });
});

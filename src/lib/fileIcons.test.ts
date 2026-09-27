import { describe, expect, it } from "vitest";
import { dirFace, fileFace, glyphOf, usedGlyphs } from "./fileIcons";

// ファイルとフォルダの顔。名前 → 拡張子 → 既定の順に引く。

describe("fileFace", () => {
  it("名前が拡張子より先に効く", () => {
    expect(fileFace("package.json").glyph).toBe("brand-npm");
    expect(fileFace("data.json").glyph).toBe("braces");
    expect(fileFace("README.md").glyph).toBe("file-info");
    expect(fileFace("notes.md").glyph).toBe("markdown");
  });

  it("大文字小文字を問わない。道筋でも名前で引く", () => {
    expect(fileFace("Dockerfile").glyph).toBe("brand-docker");
    expect(fileFace("src/App.TSX").glyph).toBe("file-type-tsx");
  });

  it("知らない拡張子と拡張子の無い名前は既定", () => {
    expect(fileFace("a.unknownext")).toEqual({ glyph: "file", tone: "gray" });
    expect(fileFace("NOTES")).toEqual({ glyph: "file", tone: "gray" });
  });

  it("Markdown はアクセント色", () => {
    expect(fileFace("a.md").tone).toBe("accent");
  });
});

describe("dirFace", () => {
  it("ふつうのフォルダは開くと開いた形", () => {
    expect(dirFace("misc", false).glyph).toBe("folder");
    expect(dirFace("misc", true).glyph).toBe("folder-open");
    expect(dirFace("docs", true)).toEqual({ glyph: "folder-open", tone: "accent" });
  });

  it("専用の印のフォルダは形を保つ", () => {
    expect(dirFace("src", true).glyph).toBe("folder-code");
    expect(dirFace(".github", false).glyph).toBe("brand-github");
  });
});

describe("字形の取り込み", () => {
  it("表に並べた字形は、どれも取り込めている", () => {
    const missing = [...new Set(usedGlyphs())].filter((name) => !glyphOf(name));
    expect(missing).toEqual([]);
  });

  it("外枠と大きさ合わせの四角は外してある", () => {
    const inner = glyphOf("file-type-ts")!;
    expect(inner).not.toContain("<svg");
    expect(inner).not.toContain('d="M0 0h24v24H0z"');
    expect(inner).toContain("<path");
  });
});

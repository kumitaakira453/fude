import { describe, expect, it } from "vitest";
import { iconOf, isViewable, kindOf } from "./kind";

describe("拡張子から見せ方を決める", () => {
  it("Markdown", () => {
    expect(kindOf("メモ.md")).toBe("markdown");
    expect(kindOf("/a/b/メモ.markdown")).toBe("markdown");
    expect(kindOf("メモ.MD")).toBe("markdown");
  });

  it("画像は WebKit が描ける形を広く受ける", () => {
    for (const name of ["a.png", "a.JPG", "a.jpeg", "a.gif", "a.webp", "a.avif", "a.svg", "a.bmp", "a.ico", "a.tiff", "a.heic"]) {
      expect(kindOf(name)).toBe("image");
    }
  });

  it("HTML と PDF", () => {
    expect(kindOf("index.html")).toBe("html");
    expect(kindOf("a.htm")).toBe("html");
    expect(kindOf("資料.pdf")).toBe("pdf");
  });

  it("字で書かれたものは text", () => {
    for (const name of ["a.txt", "a.ts", "設定.json", "a.yaml", "Makefile", "LICENSE", ".gitignore"]) {
      expect(kindOf(name)).toBe("text");
    }
  });

  it("字にならないものだけ other", () => {
    for (const name of ["a.mp4", "書庫.zip", "a.woff2", "表.xlsx", "a.dylib", "控え.sqlite"]) {
      expect(kindOf(name)).toBe("other");
    }
  });

  it("開けるかどうかは種別に従う", () => {
    expect(isViewable("a.txt")).toBe(true);
    expect(isViewable("a.png")).toBe(true);
    expect(isViewable("a.zip")).toBe(false);
  });

  it("二重拡張子は末尾で決まる", () => {
    expect(kindOf("図.md.png")).toBe("image");
    expect(kindOf("控え.png.md")).toBe("markdown");
  });

  it("点の無い名前や、拡張子だけの名前に惑わされない", () => {
    // 拡張子として付いていなければ画像ではない。字として開く。
    expect(kindOf("png")).toBe("text");
    expect(kindOf(".png")).toBe("image");
    expect(kindOf("/a/b.png/c")).toBe("text");
  });
});

describe("一覧に出す顔", () => {
  it("種類ごとに変わる", () => {
    expect(iconOf("メモ.md")).toBe("markdown");
    expect(iconOf("頁.html")).toBe("html");
    expect(iconOf("資料.pdf")).toBe("picture_as_pdf");
    expect(iconOf("控え.txt")).toBe("draft");
    expect(iconOf("書庫.zip")).toBe("draft");
  });

  it("画像は形ごとに分ける", () => {
    expect(iconOf("図.svg")).toBe("shapes");
    expect(iconOf("動く.gif")).toBe("gif_box");
    expect(iconOf("写真.JPG")).toBe("image");
    expect(iconOf("絵.png")).toBe("image");
    expect(iconOf("絵.webp")).toBe("image");
  });
});

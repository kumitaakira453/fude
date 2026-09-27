import { describe, expect, it } from "vitest";
import { cssWidth, readImageHtml, writeImageHtml } from "./imageHtml";

// 寄せと幅を持つ画像の原文。読める形だけを読み、書くときは同じ形に戻す。

describe("readImageHtml", () => {
  it("<p align> の中の <img> 1 枚を読む", () => {
    expect(readImageHtml('<p align="right"><img src="./images/図.png" alt="図" width="40%"></p>')).toEqual({
      src: "./images/図.png",
      alt: "図",
      title: null,
      align: "right",
      width: "40%",
    });
  });

  it("<img> だけの行と、中央の <p align> は寄せを持たない", () => {
    expect(readImageHtml('<img src="a.png" width="320">')?.align).toBeNull();
    expect(readImageHtml('<p align="center"><img src="a.png"></p>')?.align).toBeNull();
  });

  it("引用符なし・閉じの / 付きも読む。文字参照はほどく", () => {
    expect(readImageHtml("<img src=./images/a.png width=50% />")).toMatchObject({
      src: "./images/a.png",
      width: "50%",
    });
    expect(readImageHtml('<img src="a.png" alt="A &amp; B">')?.alt).toBe("A & B");
  });

  it("ほかの属性や余計な中身があるものは読まない（書き戻すと落ちる）", () => {
    for (const html of [
      '<img src="a.png" class="x">',
      '<img src="a.png" height="100">',
      '<p align="right" class="x"><img src="a.png"></p>',
      '<p align="right"><img src="a.png"><img src="b.png"></p>',
      '<p align="right">字 <img src="a.png"></p>',
      '<img alt="src が無い">',
      '<img src="a.png" width="auto">',
    ]) {
      expect(readImageHtml(html)).toBeNull();
    }
  });
});

describe("writeImageHtml", () => {
  const base = { src: "./images/a.png", alt: "図", title: null, align: null, width: null };

  it("寄せも幅も無ければ書かない（![]() のまま）", () => {
    expect(writeImageHtml(base)).toBeNull();
  });

  it("寄せは <p align> で包み、中央は包まない", () => {
    expect(writeImageHtml({ ...base, align: "left", width: "30%" })).toBe(
      '<p align="left"><img src="./images/a.png" alt="図" width="30%"></p>',
    );
    expect(writeImageHtml({ ...base, width: "30%" })).toBe('<img src="./images/a.png" alt="図" width="30%">');
  });

  it("属性の値の \" と & を逃がす。読み直すと同じ中身に戻る", () => {
    const img = { ...base, alt: 'A "B" & C', align: "right" as const };
    expect(readImageHtml(writeImageHtml(img)!)).toEqual(img);
  });
});

describe("cssWidth", () => {
  it("% はそのまま、数値は px", () => {
    expect(cssWidth("40%")).toBe("40%");
    expect(cssWidth("320")).toBe("320px");
    expect(cssWidth("320px")).toBe("320px");
    expect(cssWidth(null)).toBeUndefined();
  });
});

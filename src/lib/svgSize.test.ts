import { describe, expect, it } from "vitest";
import { svgSize } from "./svgSize";

describe("SVG の大きさを読む", () => {
  it("width / height を数で書いてあれば、それ", () => {
    expect(svgSize('<svg width="240" height="160" viewBox="0 0 480 320"></svg>')).toEqual({
      width: 240,
      height: 160,
    });
    expect(svgSize('<svg width="240px" height="160px"></svg>')).toEqual({
      width: 240,
      height: 160,
    });
  });

  it("寸法が無ければ見取り枠の縦横を使う", () => {
    expect(svgSize('<svg viewBox="0 0 480 320"></svg>')).toEqual({ width: 480, height: 320 });
    expect(svgSize('<svg viewBox="0,0,100,50"></svg>')).toEqual({ width: 100, height: 50 });
  });

  it("割合で書いてあるものは見取り枠に譲る", () => {
    expect(svgSize('<svg width="100%" height="100%" viewBox="0 0 60 30"></svg>')).toEqual({
      width: 60,
      height: 30,
    });
  });

  it("どちらも無ければ分からない", () => {
    expect(svgSize("<svg></svg>")).toBeNull();
    expect(svgSize('<svg viewBox="0 0 abc 10"></svg>')).toBeNull();
    expect(svgSize('<svg viewBox="0 0 0 0"></svg>')).toBeNull();
  });

  it("前書きや入れ子の svg に惑わされない", () => {
    const text = `<?xml version="1.0"?>\n<!-- svg width="9" -->\n<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><svg width="99" height="99"/></svg>`;
    expect(svgSize(text)).toEqual({ width: 12, height: 8 });
  });
});

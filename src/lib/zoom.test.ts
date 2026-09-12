import { describe, expect, it } from "vitest";
import { clampPan, fitScale, MAX_SCALE, MIN_SCALE, panBy, wheelZoom, zoomAt } from "./zoom";

const box = { width: 800, height: 600 };

describe("枠に合わせる倍率", () => {
  it("大きい画像は、余白を残して収まるところまで縮める", () => {
    // 800 - 24 * 2 = 752 に収める。
    expect(fitScale({ width: 1600, height: 600 }, box)).toBeCloseTo(752 / 1600, 10);
    expect(fitScale({ width: 800, height: 1200 }, box)).toBeCloseTo(552 / 1200, 10);
  });

  it("狭い枠では余白を取り過ぎない", () => {
    const tight = { width: 60, height: 40 };
    expect(fitScale({ width: 600, height: 400 }, tight)).toBeCloseTo(30 / 600, 10);
  });

  it("小さい画像は引き伸ばさない", () => {
    expect(fitScale({ width: 100, height: 80 }, box)).toBe(1);
  });

  it("大きさの分からない相手でも 1 を返す", () => {
    expect(fitScale({ width: 0, height: 0 }, box)).toBe(1);
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });
});

describe("指した点を動かさずに拡大する", () => {
  const natural = { width: 1600, height: 1200 };

  it("枠の中心で拡大すると位置は動かない", () => {
    const at = { x: 400, y: 300 };
    const next = zoomAt({ scale: 0.5, x: 0, y: 0 }, natural, box, 1, at);
    expect(next).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("余白のぶん、枠に合わせても縁に付かない", () => {
    const scale = fitScale(natural, box);
    expect(natural.width * scale).toBeLessThanOrEqual(box.width - 40);
  });

  it("端を指して拡大すると、その点の下の絵が同じ場所に残る", () => {
    const at = { x: 700, y: 500 };
    const from = { scale: 0.5, x: 0, y: 0 };
    const next = zoomAt(from, natural, box, 1, at);
    // 指した点の下にある「画像の中の場所」が、拡大の前後で同じ画面位置に来る。
    const place = (v: typeof from) => ({
      x: (at.x - box.width / 2 - v.x) / v.scale,
      y: (at.y - box.height / 2 - v.y) / v.scale,
    });
    expect(place(next).x).toBeCloseTo(place(from).x, 6);
    expect(place(next).y).toBeCloseTo(place(from).y, 6);
  });

  it("上限と下限で止まる", () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, natural, box, 1000, { x: 0, y: 0 }).scale).toBe(
      MAX_SCALE,
    );
    expect(
      zoomAt({ scale: 1, x: 0, y: 0 }, natural, box, 0.0001, { x: 0, y: 0 }).scale,
    ).toBe(MIN_SCALE);
  });
});

describe("端で止める", () => {
  it("枠に収まっているうちは中央から動かさない", () => {
    const natural = { width: 400, height: 300 };
    expect(panBy({ scale: 1, x: 0, y: 0 }, { x: 200, y: 200 }, natural, box)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  it("はみ出した分だけ動かせる", () => {
    const natural = { width: 1000, height: 600 };
    // 横は 1000 - 800 = 200 はみ出す。動かせるのは左右に 100 ずつ。
    expect(panBy({ scale: 1, x: 0, y: 0 }, { x: 500, y: 0 }, natural, box).x).toBe(100);
    expect(panBy({ scale: 1, x: 0, y: 0 }, { x: -500, y: 0 }, natural, box).x).toBe(-100);
  });

  it("縮めたら中央へ戻る", () => {
    const natural = { width: 1000, height: 600 };
    expect(clampPan({ scale: 0.5, x: 100, y: 0 }, natural, box)).toEqual({
      scale: 0.5,
      x: 0,
      y: 0,
    });
  });
});

describe("ピンチの刻み", () => {
  it("指を開くと大きく、閉じると小さくなる", () => {
    expect(wheelZoom(1, -90)).toBeGreaterThan(1);
    expect(wheelZoom(1, 90)).toBeLessThan(1);
  });

  it("同じ刻みなら、どの倍率でも同じ比で変わる", () => {
    expect(wheelZoom(2, -50) / 2).toBeCloseTo(wheelZoom(4, -50) / 4, 10);
  });
});

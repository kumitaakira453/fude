import { describe, expect, it } from "vitest";
import { placeNear, seenIn } from "./floatAt";

// 画面に浮かせるものの置き場所。数字だけで決まるので、画面を作らずに見る。

const ROOM = { top: 0, left: 0, width: 1000, height: 800 };
const SIZE = { width: 200, height: 40 };

describe("選んだところの近くへ置く", () => {
  it("下に入るなら下に出す", () => {
    expect(placeNear({ top: 100, bottom: 120, left: 300 }, SIZE, ROOM)).toEqual({
      top: 128,
      left: 300,
    });
  });

  it("下に入らないなら上に出す", () => {
    // 下端 780 のすぐ下には 40 の高さが入らない。
    expect(placeNear({ top: 760, bottom: 780, left: 300 }, SIZE, ROOM)).toEqual({
      top: 712,
      left: 300,
    });
  });

  it("相手が画面の下へ送られても、縁で止める", () => {
    const spot = placeNear({ top: 900, bottom: 920, left: 300 }, SIZE, ROOM);
    expect(spot.top).toBe(ROOM.height - 8 - SIZE.height);
  });

  it("相手が画面の上へ送られても、縁で止める", () => {
    expect(placeNear({ top: -200, bottom: -180, left: 300 }, SIZE, ROOM).top).toBe(8);
  });

  it("上下どちらにも入らないときは画面に収める", () => {
    const tall = { width: 200, height: 700 };
    const at = { top: 300, bottom: 400, left: 300 };
    const spot = placeNear(at, tall, ROOM);
    expect(spot.top).toBeGreaterThanOrEqual(8);
    expect(spot.top + tall.height).toBeLessThanOrEqual(ROOM.height - 8);
  });

  it("右へはみ出すなら左へ寄せる", () => {
    expect(placeNear({ top: 100, bottom: 120, left: 950 }, SIZE, ROOM).left).toBe(792);
  });

  it("左の縁より内側に置く", () => {
    expect(placeNear({ top: 100, bottom: 120, left: -40 }, SIZE, ROOM).left).toBe(8);
  });

  it("ちょうど入る高さなら下のまま", () => {
    // 下端 752 + 隙間 8 + 高さ 40 = 800 − 縁 8 にちょうど収まる。
    expect(placeNear({ top: 730, bottom: 744, left: 10 }, SIZE, ROOM).top).toBe(752);
  });
});

describe("枠が画面ぜんたいでないとき", () => {
  // ペインは上から 120、左から 300 のところに 600x500 で置かれている。
  const PANE = { top: 120, left: 300, width: 600, height: 500 };

  it("枠の上の縁で止める", () => {
    const spot = placeNear({ top: 100, bottom: 110, left: 400 }, SIZE, PANE);
    expect(spot.top).toBe(128);
  });

  it("枠の下の縁で止める", () => {
    const spot = placeNear({ top: 700, bottom: 720, left: 400 }, SIZE, PANE);
    expect(spot.top).toBe(120 + 500 - 8 - SIZE.height);
  });

  it("枠の左の縁で止める", () => {
    expect(placeNear({ top: 300, bottom: 320, left: 0 }, SIZE, PANE).left).toBe(308);
  });

  it("枠の右の縁で止める", () => {
    expect(placeNear({ top: 300, bottom: 320, left: 880 }, SIZE, PANE).left).toBe(
      300 + 600 - 8 - SIZE.width,
    );
  });

  it("入るなら相手のすぐ下", () => {
    expect(placeNear({ top: 300, bottom: 320, left: 400 }, SIZE, PANE)).toEqual({
      top: 328,
      left: 400,
    });
  });

  it("下に入らなければ上へ回す", () => {
    // 枠の下端 620。下端 580 のすぐ下には 40 の高さが入らない。
    const spot = placeNear({ top: 560, bottom: 580, left: 400 }, SIZE, PANE);
    expect(spot.top).toBe(512);
  });
});

describe("縦を止めないとき", () => {
  const PANE = { top: 120, left: 300, width: 600, height: 500 };

  it("枠の上へ流れた相手には、そのまま付いていく", () => {
    const spot = placeNear({ top: -200, bottom: -180, left: 400 }, SIZE, PANE, false);
    expect(spot.top).toBe(-172);
  });

  it("上下どちらへ出すかは枠で決まる", () => {
    // 枠の下端 620。下端 580 のすぐ下には 40 の高さが入らないので上へ。
    expect(placeNear({ top: 560, bottom: 580, left: 400 }, SIZE, PANE, false).top).toBe(512);
  });

  it("横は止めたままにする", () => {
    expect(placeNear({ top: 300, bottom: 320, left: 0 }, SIZE, PANE, false).left).toBe(308);
  });
});

describe("枠に掛かっているか", () => {
  const PANE = { top: 120, left: 300, width: 600, height: 500 };

  it("中にあれば掛かっている", () => {
    expect(seenIn({ top: 300, bottom: 320 }, PANE)).toBe(true);
  });

  it("下の縁に半分かかっていても掛かっている", () => {
    expect(seenIn({ top: 600, bottom: 640 }, PANE)).toBe(true);
  });

  it("上へ抜けたら外れている", () => {
    expect(seenIn({ top: 60, bottom: 119 }, PANE)).toBe(false);
  });

  it("下へ抜けたら外れている", () => {
    expect(seenIn({ top: 620, bottom: 660 }, PANE)).toBe(false);
  });
});

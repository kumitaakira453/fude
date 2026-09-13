import { describe, expect, it } from "vitest";
import { placeNear } from "./floatAt";

// 画面に浮かせるものの置き場所。数字だけで決まるので、画面を作らずに見る。

const ROOM = { width: 1000, height: 800 };
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

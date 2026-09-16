// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickImageFile } from "./kind";

// 画像を選ぶ小窓。二重に開かせないところを見る。
//
// OS の選択窓が二重に開くと、主たる実行の環がどちらを待てばよいか決まらず、
// 窓ごと止まることがある。

let opens = 0;
let answer: (path: string | null) => void = () => {};

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: () => {
    opens += 1;
    return new Promise<string | null>((done) => {
      answer = done;
    });
  },
}));

// 窓は押下の処理から抜けたあと（次のフレーム）で出す。
const frames: FrameRequestCallback[] = [];
const tick = () => {
  const run = frames.splice(0);
  for (const f of run) f(0);
};

beforeEach(() => {
  opens = 0;
  frames.length = 0;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    frames.push(f);
    return frames.length;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickImageFile", () => {
  it("押下の処理から抜けてから開く", async () => {
    const out = pickImageFile();
    expect(opens).toBe(0);
    tick();
    expect(opens).toBe(1);
    answer(null);
    await out;
  });

  it("開いている最中の 2 度目は同じ 1 枚に相乗りする", async () => {
    const first = pickImageFile();
    const second = pickImageFile();
    tick();
    expect(opens).toBe(1);
    answer("/Users/me/写真/図解.png");
    expect(await first).toBe("/Users/me/写真/図解.png");
    expect(await second).toBe("/Users/me/写真/図解.png");
  });

  it("閉じたあとは、また開ける", async () => {
    const first = pickImageFile();
    tick();
    answer(null);
    expect(await first).toBeNull();
    void pickImageFile();
    tick();
    expect(opens).toBe(2);
  });

  it("選ばなければ null", async () => {
    const out = pickImageFile();
    tick();
    answer(null);
    expect(await out).toBeNull();
  });
});

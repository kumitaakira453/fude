// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 控えはモジュールを読んだ時点で入るので、試験ごとに読み直す。
async function fresh() {
  vi.resetModules();
  return await import("./viewpoint");
}

const STORE_KEY = "mdglow:seen";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("見ていた場所", () => {
  it("覚えて呼び戻せる", async () => {
    const vp = await fresh();
    const key = vp.viewKey("p1", "/docs/a.md");
    vp.rememberViewpoint(key, 120, 8);
    expect(vp.recallViewpoint(key)).toEqual({ at: 120, into: 8 });
  });

  it("知らない鍵は先頭を返す", async () => {
    const vp = await fresh();
    expect(vp.recallViewpoint(vp.viewKey("p1", "/docs/b.md"))).toEqual({
      at: 0,
      into: 0,
    });
    // ファイルを開いていないペインは鍵を持たない
    expect(vp.viewKey("p1", null)).toBeNull();
    expect(vp.recallViewpoint(null)).toEqual({ at: 0, into: 0 });
  });

  it("ペインごとに別の場所を覚える", async () => {
    const vp = await fresh();
    vp.rememberViewpoint(vp.viewKey("p1", "/docs/a.md"), 10);
    vp.rememberViewpoint(vp.viewKey("p2", "/docs/a.md"), 90);
    expect(vp.recallViewpoint(vp.viewKey("p1", "/docs/a.md")).at).toBe(10);
    expect(vp.recallViewpoint(vp.viewKey("p2", "/docs/a.md")).at).toBe(90);
  });

  it("覚えすぎたら古いものから捨てる", async () => {
    const vp = await fresh();
    for (let i = 0; i < 70; i++) {
      vp.rememberViewpoint(vp.viewKey("p1", `/docs/${i}.md`), i + 1);
    }
    // いちばん古いものは落ち、新しいものは残る
    expect(vp.recallViewpoint(vp.viewKey("p1", "/docs/0.md")).at).toBe(0);
    expect(vp.recallViewpoint(vp.viewKey("p1", "/docs/69.md")).at).toBe(70);
  });

  it("控えへ書き戻し、読み直せる", async () => {
    const first = await fresh();
    first.rememberViewpoint(first.viewKey("p1", "/docs/a.md"), 240, 16);
    first.flushViewpoints();
    expect(localStorage.getItem(STORE_KEY)).toBeTruthy();

    const again = await fresh();
    expect(again.recallViewpoint(again.viewKey("p1", "/docs/a.md"))).toEqual({
      at: 240,
      into: 16,
    });
  });

  it("壊れた控えは黙って捨てる", async () => {
    for (const broken of ["{", "null", "[1,2]", '{"p1 /a.md":"どこか"}', '{"k":{"at":"x"}}']) {
      localStorage.setItem(STORE_KEY, broken);
      const vp = await fresh();
      expect(vp.recallViewpoint(vp.viewKey("p1", "/a.md"))).toEqual({
        at: 0,
        into: 0,
      });
    }
  });
});

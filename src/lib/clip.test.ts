import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clip";

// 写せたかどうかを返す。写せていないのに黙ると、貼りに行ってから気づく。

const board = (impl: (text: string) => Promise<void>) => {
  const writeText = vi.fn(impl);
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText } },
    configurable: true,
  });
  return writeText;
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "navigator");
});

describe("写し取り", () => {
  it("書いた中身をそのまま渡す", async () => {
    const writeText = board(() => Promise.resolve());
    expect(await copyText("# 見出し\n本文\n")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("# 見出し\n本文\n");
  });

  it("空でも写す", async () => {
    const writeText = board(() => Promise.resolve());
    expect(await copyText("")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("");
  });

  it("断られたら false", async () => {
    board(() => Promise.reject(new Error("拒否")));
    expect(await copyText("あ")).toBe(false);
  });

  it("写す口が無い場でも落ちない", async () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    expect(await copyText("あ")).toBe(false);
  });
});

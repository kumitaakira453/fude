// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clip";

// アプリ側（Rust）の口。荷は動的に読むので、ここで差し替えておく。
const appWrite = vi.fn<(text: string) => Promise<void>>();
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (text: string) => appWrite(text),
}));

// アプリの中に居るか。見分けは window の印で行う。
const asApp = (yes: boolean) => {
  if (yes) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
};

// ブラウザ側の口。写せたかどうかを返すので、断られる場も試す。
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
  asApp(false);
  appWrite.mockReset();
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

  it("アプリの中ではアプリ側の口へ通す", async () => {
    const writeText = board(() => Promise.resolve());
    asApp(true);
    appWrite.mockResolvedValue(undefined);
    expect(await copyText("あ")).toBe(true);
    expect(appWrite).toHaveBeenCalledWith("あ");
    // ブラウザの口は使わない。
    expect(writeText).not.toHaveBeenCalled();
  });

  it("アプリ側が駄目なら、ブラウザの口へ落ちる", async () => {
    const writeText = board(() => Promise.resolve());
    asApp(true);
    appWrite.mockRejectedValue(new Error("使えない"));
    expect(await copyText("あ")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("あ");
  });

  it("写す口が無い場でも落ちない", async () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    expect(await copyText("あ")).toBe(false);
  });
});

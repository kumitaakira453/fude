import { beforeEach, describe, expect, it, vi } from "vitest";

// 外のアプリで開く項目。入っているアプリだけを出し、押すと開き方に合わせた
// 命令を呼ぶ（nvim は Ghostty の窓で開く命令）。

const calls: [string, unknown][] = [];
let installed: string[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: unknown) => {
    calls.push([cmd, args]);
    return cmd === "installed_apps" ? installed : undefined;
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: async () => {} }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: async () => {} }));

const { availableApps, EXTERNAL_APPS, openWith } = await import("./external");

beforeEach(() => {
  calls.length = 0;
  installed = [];
});

const app = (id: string) => EXTERNAL_APPS.find((a) => a.id === id)!;

describe("外のアプリで開く", () => {
  it("入っているアプリだけを出す", async () => {
    installed = ["Visual Studio Code", "Ghostty"];
    expect((await availableApps()).map((a) => a.id)).toEqual(["vscode", "nvim"]);
  });

  it("エディタはアプリに渡し、nvim は Ghostty の窓で開く命令にファイルかフォルダかを添える", async () => {
    openWith("/本/a.md", app("vscode"), false);
    openWith("/本/a.md", app("nvim"), false);
    openWith("/本/資料", app("nvim"), true);
    await Promise.resolve();
    expect(calls).toEqual([
      ["open_in_app", { app: "Visual Studio Code", path: "/本/a.md" }],
      ["open_in_terminal", { path: "/本/a.md", isDir: false }],
      ["open_in_terminal", { path: "/本/資料", isDir: true }],
    ]);
  });
});

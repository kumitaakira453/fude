import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES } from "./themes";

// index.html は画面の JS より前に動き、前回のテーマの地とアクセントを当てる。
// その色の表は CSS と別に持っているので、テーマを足したり色を変えたりしたときに
// 置き去りにならないよう、ここで突き合わせる。

const root = resolve(__dirname, "../..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const css = readFileSync(resolve(root, "src/index.css"), "utf8");

const bootTable = (): Record<string, [string, string]> => {
  const out: Record<string, [string, string]> = {};
  for (const m of html.matchAll(/^\s*(\w+): \["(#[0-9a-f]{6})", "(#[0-9a-f]{6})"\],$/gim)) {
    out[m[1]] = [m[2].toLowerCase(), m[3].toLowerCase()];
  }
  return out;
};

const cssColor = (id: string, name: string): string | undefined => {
  const block = css.match(new RegExp(`^\\[data-theme="${id}"\\] \\{([\\s\\S]*?)^\\}`, "m"));
  return block?.[1].match(new RegExp(`--mg-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1].toLowerCase();
};

describe("起動直後の見た目", () => {
  it("どのテーマも表にある（余分なものも無い）", () => {
    expect(Object.keys(bootTable()).sort()).toEqual(THEMES.map((t) => t.id).sort());
  });

  it("地とアクセントは CSS のテーマの値と同じ", () => {
    for (const [id, [bg, accent]] of Object.entries(bootTable())) {
      expect([id, bg]).toEqual([id, cssColor(id, "bg")]);
      expect([id, accent]).toEqual([id, cssColor(id, "accent")]);
    }
  });
});

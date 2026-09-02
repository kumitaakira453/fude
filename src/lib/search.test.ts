import { describe, expect, it } from "vitest";
import type { TreeNode } from "./fsAccess";
import { quickOpen, recencyBonus } from "./search";

const file = (path: string): TreeNode => ({
  name: path.split("/").pop() ?? path,
  path,
  abs: `/root/${path}`,
  kind: "file",
});

const FILES = [file("a/old.md"), file("a/fresh.md"), file("b/mid.md")];

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const TOUCHED = new Map([
  ["a/old.md", NOW - 60 * DAY],
  ["a/fresh.md", NOW - 60 * 1000],
  ["b/mid.md", NOW - 2 * DAY],
]);

const paths = (list: { node: TreeNode }[]) => list.map((r) => r.node.path);

describe("recencyBonus", () => {
  it("触っていないものは 0", () => {
    expect(recencyBonus(30, undefined, NOW)).toBe(0);
    expect(recencyBonus(30, 0, NOW)).toBe(0);
  });

  it("1 日ごとに半分になる", () => {
    const fresh = recencyBonus(30, NOW, NOW);
    expect(recencyBonus(30, NOW - DAY, NOW)).toBeCloseTo(fresh / 2, 6);
    expect(recencyBonus(30, NOW - 2 * DAY, NOW)).toBeCloseTo(fresh / 4, 6);
  });

  it("一致の強さに比例する", () => {
    expect(recencyBonus(60, NOW, NOW)).toBeCloseTo(
      recencyBonus(30, NOW, NOW) * 2,
      6,
    );
  });

  it("未来の時刻でも上限を越えない", () => {
    expect(recencyBonus(30, NOW + DAY, NOW)).toBe(recencyBonus(30, NOW, NOW));
  });
});

describe("quickOpen", () => {
  it("絞り込みが空なら新しく触った順", () => {
    expect(paths(quickOpen(FILES, "", { touched: TOUCHED, now: NOW }))).toEqual([
      "a/fresh.md",
      "b/mid.md",
      "a/old.md",
    ]);
  });

  it("触った時刻を渡さなければ元の並びのまま", () => {
    expect(paths(quickOpen(FILES, "", { now: NOW }))).toEqual([
      "a/old.md",
      "a/fresh.md",
      "b/mid.md",
    ]);
  });

  it("名前の一致が同じなら新しい方が先に出る", () => {
    const same = [file("x/note.md"), file("y/note.md")];
    const touched = new Map([["y/note.md", NOW]]);
    expect(paths(quickOpen(same, "note", { touched, now: NOW }))).toEqual([
      "y/note.md",
      "x/note.md",
    ]);
  });

  it("新しさで名前の一致を覆さない", () => {
    const files = [file("guide.md"), file("g-u-i-d-e-old.md")];
    const touched = new Map([["g-u-i-d-e-old.md", NOW]]);
    expect(paths(quickOpen(files, "guide", { touched, now: NOW }))[0]).toBe(
      "guide.md",
    );
  });

  it("一致しないものは落とす", () => {
    expect(paths(quickOpen(FILES, "zzz", { now: NOW }))).toEqual([]);
  });

  it("件数を絞る", () => {
    expect(quickOpen(FILES, "", { touched: TOUCHED, now: NOW, limit: 2 })).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import type { TreeNode } from "./fsAccess";
import {
  quickOpen,
  readable,
  recencyBonus,
  searchContents,
  stepHit,
} from "./search";

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

describe("stepHit", () => {
  it("次へ / 前へで送り、端で回り込む", () => {
    expect(stepHit({ at: 0, went: 0 }, 1, 3).at).toBe(1);
    expect(stepHit({ at: 2, went: 0 }, 1, 3).at).toBe(0);
    expect(stepHit({ at: 0, went: 0 }, -1, 3).at).toBe(2);
  });

  it("ヒットが 1 件でも「送った」ことは残る", () => {
    // ここが肝。位置は変わらないので、位置だけを見ていると画面が動かない
    // （1 件だけヒットしたときに Enter で飛べなかった原因）。
    const next = stepHit({ at: 0, went: 4 }, 1, 1);
    expect(next.at).toBe(0);
    expect(next.went).toBe(5);
  });

  it("同じ位置へ何度でも送れる", () => {
    let now = { at: 0, went: 0 };
    for (let i = 0; i < 3; i++) now = stepHit(now, 1, 1);
    expect(now).toEqual({ at: 0, went: 3 });
  });

  it("ヒットが無ければ先頭のまま", () => {
    expect(stepHit({ at: 0, went: 1 }, 1, 0)).toEqual({ at: 0, went: 2 });
  });
});

describe("readable", () => {
  it("飾りの無い行はそのまま", () => {
    expect(readable("ただの一行です。")).toBe("ただの一行です。");
  });

  it("強調・取り消し・コードの記号を落とす", () => {
    expect(readable("**重要**な点")).toBe("重要な点");
    expect(readable("__太字__の後")).toBe("太字の後");
    expect(readable("*斜体*と~~取り消し~~")).toBe("斜体と取り消し");
    expect(readable("`code` を挟む")).toBe("code を挟む");
  });

  it("リンクと画像は札だけ残す", () => {
    expect(readable("[入口](https://example.com/a)を見る")).toBe("入口を見る");
    expect(readable("![図の説明](fig.png)")).toBe("図の説明");
    expect(readable("[札][ref] を引く")).toBe("札 を引く");
    expect(readable("<https://example.com/a>")).toBe("https://example.com/a");
  });

  it("英数字に挟まれた _ は飾りではない", () => {
    expect(readable("snake_case_name を直す")).toBe("snake_case_name を直す");
  });

  it("逃がした記号は記号だけ残す", () => {
    expect(readable("2 \\* 3 は 6")).toBe("2 * 3 は 6");
  });
});

describe("searchContents", () => {
  const OPTS = { caseSensitive: false, useRegex: false, wholeWord: false };
  const find = (body: string, query: string) =>
    searchContents(new Map([["doc.md", body]]), query, OPTS);

  it("飾りをまたぐ語が当たる", () => {
    const { total, results } = find("源では **重要**な点 と書いてある。", "重要な点");
    expect(total).toBe(1);
    expect(results[0].hits[0].line).toBe(1);
  });

  it("見せる行からも飾りが落ちる", () => {
    const { results } = find("**重要**な点", "重要");
    const hit = results[0].hits[0];
    expect(hit.preview).toBe("重要な点");
    expect(hit.preview.slice(hit.column, hit.column + hit.length)).toBe("重要");
  });

  it("リンクは札に当たり、URL には当たらない", () => {
    expect(find("[入口](https://example.com/secret)", "入口").total).toBe(1);
    expect(find("[入口](https://example.com/secret)", "secret").total).toBe(0);
  });

  it("行番号は源のまま数える", () => {
    const { results } = find("一行目\n\n**三**行目", "三行目");
    expect(results[0].hits[0].line).toBe(3);
  });
});

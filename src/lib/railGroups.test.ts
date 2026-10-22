import { describe, expect, it } from "vitest";
import { groupKeyOf, initialOf, railGroups, railOrder } from "./railGroups";
import type { Workspace } from "./workspaces";

// 左端の帯のまとまり。フォルダごとに寄せ、.claude は飛ばし、順は列に従う。

const ws = (id: string, roots: string[], over: Partial<Workspace> = {}): Workspace => ({
  id,
  name: id,
  color: "teal",
  roots,
  lastOpened: 0,
  ...over,
});

describe("帯のまとまり", () => {
  it(".claude を除いた最初のフォルダのまとまりに入れる", () => {
    expect(groupKeyOf(ws("a", ["/w/monorepo/.claude", "/w/monorepo", "/w/docs"]))).toBe("/w/monorepo");
    expect(groupKeyOf(ws("b", ["/w/fude"], { folder: "/w/fude" }))).toBe("/w/fude");
    // 全部 .claude なら最初のもの。
    expect(groupKeyOf(ws("c", ["/u/.claude"]))).toBe("/u/.claude");
  });

  it("まとまりの順もまとまりの中の順も列に従い、⌘ の順は見えている上から", () => {
    const list = [
      ws("f1", ["/w/fude"]),
      ws("m1", ["/w/monorepo"]),
      ws("f2", ["/w/fude"]),
      ws("m2", ["/w/monorepo/.claude", "/w/monorepo"]),
    ];
    const bar = ["f1", "m1", "f2", "m2"];
    expect(railGroups(bar, list).map((g) => [g.label, g.items.map((w) => w.id)])).toEqual([
      ["fude", ["f1", "f2"]],
      ["monorepo", ["m1", "m2"]],
    ]);
    expect(railOrder(bar, list)).toEqual(["f1", "f2", "m1", "m2"]);
  });

  it("札の 1 字は頭の印を飛ばす", () => {
    expect(initialOf("[V]マークダウン")).toBe("マ");
    expect(initialOf("fude")).toBe("f");
    expect(initialOf("[B]")).toBe("[");
  });
});

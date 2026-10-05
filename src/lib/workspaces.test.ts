import { describe, expect, it } from "vitest";
import { asWorkspace, freeColor, newWorkspaceId, rootsSummary, type Workspace } from "./workspaces";

const ws = (id: string, color: Workspace["color"]): Workspace => ({
  id,
  name: id,
  color,
  roots: ["/a"],
  lastOpened: 0,
});

describe("ワークスペースの控え", () => {
  it("ID は Rust がファイル名に通す字だけで作る", () => {
    const id = newWorkspaceId(1_700_000_000_000, () => 0.5);
    expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(id.startsWith("ws-")).toBe(true);
  });

  it("色はまだ使われていないものから、全部使われていれば少ないものから", () => {
    expect(freeColor([])).toBe("teal");
    expect(freeColor([ws("1", "teal")])).toBe("sky");
    const all = (["teal", "sky", "violet", "rose", "amber", "lime", "indigo", "slate"] as const).map(
      (c, i) => ws(String(i), c),
    );
    expect(freeColor([...all, ws("x", "teal")])).toBe("sky");
  });

  it("読めない控えは通さず、知らない色は最初の色に読み替える", () => {
    expect(asWorkspace(null)).toBeNull();
    expect(asWorkspace({ id: "a", name: "a", roots: [] })).toBeNull();
    expect(asWorkspace({ id: "a", name: "a", roots: [1] })).toBeNull();
    const got = asWorkspace({ id: "a", name: "a", roots: ["/x"], color: "紫", junk: 1 });
    expect(got).toMatchObject({ id: "a", roots: ["/x"], color: "teal", lastOpened: 0 });
    expect(got).not.toHaveProperty("junk");
  });

  it("Claude のセッションとの結びつきは、名前を追うかの既定を入にする", () => {
    const got = asWorkspace({
      id: "a",
      name: "a",
      roots: ["/x"],
      claude: { sessionId: "s", wrote: [{ path: "/x/a.md", at: 1 }, { path: 2 }] },
    });
    expect(got?.claude).toEqual({
      sessionId: "s",
      nameFollows: true,
      lastName: undefined,
      wrote: [{ path: "/x/a.md", at: 1 }],
    });
  });

  it("根の並びは先頭と残りの数で見せる", () => {
    expect(rootsSummary(["a"])).toBe("a");
    expect(rootsSummary(["a", "b", "c"])).toBe("a ほか 2");
  });
});

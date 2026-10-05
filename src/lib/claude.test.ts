import { describe, expect, it } from "vitest";
import { newlyWritten, phaseOf, type ClaudeSession } from "./claude";

const session = (over: Partial<ClaudeSession>): ClaudeSession => ({
  sessionId: "s",
  name: "[V]fude",
  kind: "background",
  ...over,
});

describe("セッションの状態", () => {
  const ok = { readable: true, transcriptGone: false };

  it("背景のセッションは段階で決める", () => {
    expect(phaseOf(session({ state: "working", status: "idle" }), ok)).toBe("working");
    expect(phaseOf(session({ state: "blocked" }), ok)).toBe("waiting");
    expect(phaseOf(session({ state: "done" }), ok)).toBe("done");
  });

  it("段階の無いセッション（対話）は動いているかで決める", () => {
    expect(phaseOf(session({ kind: "interactive", status: "busy" }), ok)).toBe("working");
    expect(phaseOf(session({ kind: "interactive", status: "idle" }), ok)).toBe("idle");
  });

  it("一覧から外れたら、記録が残っていれば終わった、無ければ削除された", () => {
    expect(phaseOf(undefined, ok)).toBe("ended");
    expect(phaseOf(undefined, { readable: true, transcriptGone: true })).toBe("deleted");
  });

  it("一覧を読めないときは、消えたと決めつけない", () => {
    expect(phaseOf(undefined, { readable: false, transcriptGone: true })).toBe("unknown");
  });
});

describe("新しく書いたファイル", () => {
  it("前に知らなかったものだけを、古い順に返す", () => {
    const before = [{ path: "/a.md", at: 1 }];
    const now = [
      { path: "/c.md", at: 9 },
      { path: "/a.md", at: 8 },
      { path: "/b.md", at: 5 },
    ];
    expect(newlyWritten(before, now).map((w) => w.path)).toEqual(["/b.md", "/c.md"]);
  });
});

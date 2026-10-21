import { describe, expect, it, vi } from "vitest";
import {
  claudeSessionFiles,
  followMoves,
  newlyWritten,
  phaseOf,
  type ClaudeSession,
} from "./claude";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => ({
    gone: false,
    wrote: [
      { path: "/w/a.md", at: 3 },
      { path: "/w/main.ts", at: 2 },
      { path: "/w/構成.d2", at: 2 },
      { path: "/w/dist.zip", at: 1 },
    ],
  }),
}));

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

describe("fude の中で動かしたファイルへ寄せる", () => {
  const wrote = [
    { path: "/根/a/x.md", at: 3 },
    { path: "/根/a/y.md", at: 2 },
    { path: "/根/b/z.md", at: 1 },
  ];

  it("動かした記録が無ければそのまま", () => {
    expect(followMoves(wrote, undefined)).toEqual(wrote);
  });

  it("ファイルの名前を変えたら、新しい名前を指す", () => {
    expect(followMoves(wrote, [["/根/a/x.md", "/根/a/X2.md"]]).map((w) => w.path)).toEqual([
      "/根/a/X2.md",
      "/根/a/y.md",
      "/根/b/z.md",
    ]);
  });

  it("フォルダごと動かしたら、中のファイルも追う（名前が似ているだけのフォルダは追わない）", () => {
    const more = [...wrote, { path: "/根/ab/w.md", at: 0 }];
    expect(followMoves(more, [["/根/a", "/根/c/a"]]).map((w) => w.path)).toEqual([
      "/根/c/a/x.md",
      "/根/c/a/y.md",
      "/根/b/z.md",
      "/根/ab/w.md",
    ]);
  });

  it("続けて動かしたら、最後の場所を指す", () => {
    expect(
      followMoves(wrote, [
        ["/根/a/x.md", "/根/b/x.md"],
        ["/根/b", "/根/c"],
      ]).map((w) => w.path),
    ).toEqual(["/根/c/x.md", "/根/a/y.md", "/根/c/z.md"]);
  });

  it("動かした先にも書いていたら 1 つにまとめ、新しい時刻を残す", () => {
    const both = [
      { path: "/根/new.md", at: 5 },
      { path: "/根/old.md", at: 2 },
    ];
    expect(followMoves(both, [["/根/old.md", "/根/new.md"]])).toEqual([{ path: "/根/new.md", at: 5 }]);
  });
});

describe("セッションが書いたファイル", () => {
  it("md 以外も、ファイルの木で開けるものは拾い、書庫などは落とす", async () => {
    const { wrote } = await claudeSessionFiles("s", "/t.jsonl");
    expect(wrote.map((w) => w.path)).toEqual(["/w/a.md", "/w/main.ts", "/w/構成.d2"]);
  });
});

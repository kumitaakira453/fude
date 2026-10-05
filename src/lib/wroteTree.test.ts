import { describe, expect, it } from "vitest";
import { wroteTree, type WroteNode } from "./wroteTree";

// セッションが書いたファイルを、フォルダごとにまとめる。

const label = (path: string) => path.replace(/^\/根\//, "");

// 木を字で描く（字下げ 2 つで 1 段）。
const draw = (nodes: WroteNode[], depth = 0): string[] =>
  nodes.flatMap((n) =>
    n.kind === "dir"
      ? [`${"  ".repeat(depth)}${n.name}/`, ...draw(n.children, depth + 1)]
      : [`${"  ".repeat(depth)}${n.name}`],
  );

describe("書いたファイルの木", () => {
  it("フォルダごとにまとめ、フォルダは名前順、ファイルは新しい順に並べる", () => {
    const tree = wroteTree(
      [
        { path: "/根/docs/古い.md", at: 1 },
        { path: "/根/docs/新しい.md", at: 3 },
        { path: "/根/specs/a.md", at: 2 },
        { path: "/根/specs/b.md", at: 2 },
        { path: "/根/README.md", at: 5 },
      ],
      label,
    );
    expect(draw(tree)).toEqual([
      "docs/",
      "  新しい.md",
      "  古い.md",
      "specs/",
      "  a.md",
      "  b.md",
      "README.md",
    ]);
  });

  it("子が 1 つしかないフォルダの連なりは 1 行に詰める", () => {
    const tree = wroteTree(
      [
        { path: "/根/.claude/skills/local-spec/SKILL.md", at: 2 },
        { path: "/根/.claude/skills/local-spec/templates/00.md", at: 1 },
      ],
      label,
    );
    expect(draw(tree)).toEqual([
      ".claude/skills/local-spec/",
      "  templates/",
      "    00.md",
      "  SKILL.md",
    ]);
  });

  it("同じ名前のファイルは、置き場所ごとに分かれる", () => {
    const tree = wroteTree(
      [
        { path: "/根/a/SKILL.md", at: 1 },
        { path: "/根/b/SKILL.md", at: 2 },
      ],
      label,
    );
    expect(draw(tree)).toEqual(["a/", "  SKILL.md", "b/", "  SKILL.md"]);
  });

  it("開閉の鍵は、詰めた分も含めた道筋になる", () => {
    const tree = wroteTree([{ path: "/根/x/y/z.md", at: 1 }], label);
    expect(tree[0]).toMatchObject({ kind: "dir", name: "x/y", key: "x/y" });
  });
});

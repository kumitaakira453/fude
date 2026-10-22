import { describe, expect, it } from "vitest";
import { tabWhere } from "./tabLabel";

// タブの名前に添えるフォルダ。重なる名前のときだけ、見分けに要る段まで。

describe("タブに添えるフォルダ", () => {
  it("名前が重ならなければ何も添えない", () => {
    expect(tabWhere("/w/fude/src/D2Doc.tsx", ["/w/fude/src/D2Doc.tsx", "/w/fude/README.md"])).toBe("");
  });

  it("重なるときは、見分けがつく段まで後ろから足す", () => {
    const all = ["/w/fude/README.md", "/w/poc/2026/d2/README.md"];
    expect(tabWhere(all[0], all)).toBe("…/fude");
    expect(tabWhere(all[1], all)).toBe("…/d2");
  });

  it("後ろの段が同じなら、もう 1 段さかのぼる", () => {
    const all = ["/w/fude/src/hooks/review/index.ts", "/w/fude/src/lib/md/review/index.ts"];
    expect(tabWhere(all[0], all)).toBe("…/hooks/review");
    expect(tabWhere(all[1], all)).toBe("…/md/review");
  });

  it("全部さかのぼって見分けがついたら …/ は付けない", () => {
    expect(tabWhere("/a/x.md", ["/a/x.md", "/b/a/x.md"])).toBe("a");
  });
});

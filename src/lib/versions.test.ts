import { describe, expect, it } from "vitest";
import { EMPTY_LEDGER, type Ledger, type ReviewVersion } from "./review";
import {
  actorOf,
  compare,
  labelOf,
  unchanged,
  versionsOf,
  type DiffRow,
} from "./versions";

function version(over: Partial<ReviewVersion>): ReviewVersion {
  return {
    id: "h",
    file: "/docs/a.md",
    label: null,
    origin: "checkpoint",
    created_at: 0,
    ...over,
  };
}

function ledgerOf(versions: ReviewVersion[]): Ledger {
  return { ...EMPTY_LEDGER, versions };
}

describe("版の一覧", () => {
  it("そのファイルの版だけを新しい順に出す", () => {
    const ledger = ledgerOf([
      version({ id: "v1", created_at: 100 }),
      version({ id: "v3", created_at: 300 }),
      version({ id: "v2", created_at: 200 }),
      version({ id: "other", file: "/docs/b.md", created_at: 999 }),
    ]);
    expect(versionsOf(ledger, "/docs/a.md").map((v) => v.id)).toEqual([
      "v3",
      "v2",
      "v1",
    ]);
  });

  it("NFD で組まれた道筋でも当たる", () => {
    // 台帳は NFC。ファイルツリー側は NFD のことがある（"が" が "か" + U+3099）
    const ledger = ledgerOf([version({ id: "v", file: "/docs/がぞう.md" })]);
    expect(versionsOf(ledger, "/docs/か\u{3099}ぞう.md")).toHaveLength(1);
  });

  it("主体は origin から決まる", () => {
    expect(actorOf("commit")).toBe("ai");
    expect(actorOf("checkpoint")).toBe("you");
    expect(actorOf("comment")).toBe("you");
  });

  it("名前が無い版は打った日時で呼ぶ", () => {
    expect(labelOf(version({ label: "下書き整理" }))).toBe("下書き整理");
    expect(labelOf(version({ label: "  " }))).not.toBe("  ");
    expect(labelOf(version({ label: null }))).not.toBe("");
  });
});

// 差分の 1 行を、種類と中身の文字で見比べられる形にする。
function shape(rows: DiffRow[]): string[] {
  return rows.map((row) => {
    switch (row.kind) {
      case "meta":
        return "meta";
      case "gap":
        return `gap:${row.blocks.length}`;
      case "kept":
        return `kept:${row.block.src.trim()}`;
      case "changed":
        return `changed:${row.base.src.trim()}→${row.head.src.trim()}`;
      case "added":
        return `added:${row.head.src.trim()}`;
      case "removed":
        return `removed:${row.base.src.trim()}`;
    }
  });
}

const SAME = ["あ", "い", "う", "え", "お"].map((c) => `${c}。`).join("\n\n");

describe("版どうしの差分", () => {
  it("変わっていない連なりを畳む", () => {
    const rows = compare(`${SAME}\n`, `${SAME}\n`);
    expect(shape(rows)).toEqual(["gap:5"]);
    expect(unchanged(rows)).toBe(true);
  });

  it("短い連なりは畳まず、そのまま出す", () => {
    expect(shape(compare("あ。\n\nい。\n", "あ。\n\nい。\n"))).toEqual([
      "kept:あ。",
      "kept:い。",
    ]);
  });

  it("書き換えは前と後を組にして出す", () => {
    const rows = compare("あ。\n\nい。\n", "あ。\n\nいい。\n");
    expect(shape(rows)).toEqual(["kept:あ。", "changed:い。→いい。"]);
    expect(unchanged(rows)).toBe(false);
  });

  it("追加と削除を落とさない", () => {
    expect(shape(compare("あ。\n\nい。\n", "あ。\n\nい。\n\nう。\n"))).toEqual([
      "kept:あ。",
      "kept:い。",
      "added:う。",
    ]);
    expect(shape(compare("あ。\n\nい。\n\nう。\n", "あ。\n\nい。\n"))).toEqual([
      "kept:あ。",
      "kept:い。",
      "removed:う。",
    ]);
  });

  it("フロントマターだけの違いも差分として出す", () => {
    const rows = compare(
      "---\ntitle: 旧\n---\n\nあ。\n",
      "---\ntitle: 新\n---\n\nあ。\n",
    );
    expect(shape(rows)).toEqual(["meta", "kept:あ。"]);
    expect(unchanged(rows)).toBe(false);
  });

  it("フロントマターが同じなら本文だけを見る", () => {
    const rows = compare(
      "---\ntitle: 同\n---\n\nあ。\n",
      "---\ntitle: 同\n---\n\nあ。\n",
    );
    expect(shape(rows)).toEqual(["kept:あ。"]);
  });
});

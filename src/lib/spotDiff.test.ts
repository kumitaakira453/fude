import { describe, expect, it } from "vitest";
import { splitBlocks } from "./blocks";
import type { ReviewThread } from "./review";
import { loose, spotDiff } from "./spotDiff";

// 指摘の箇所が、コメントしてからどうなったか。
// 見るのは状態の分かれ方と、増減の字数（コードポイントで数える）。

function thread(over: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "t1",
    file: "/doc.md",
    quote: "この機能は管理者のみが使えます。",
    block_hash: "",
    selection: "管理者のみ",
    selection_offset: 5,
    section_path: [],
    base_version: "v1",
    status: { kind: "open" },
    comments: [{ id: "c1", author: "you", body: "ここ直して", created_at: 1 }],
    created_at: 1,
    ...over,
  };
}

const BASE = "# 見出し\n\nこの機能は管理者のみが使えます。\n\nあとの段落。\n";

const of = (body: string) => splitBlocks(body);

describe("spotDiff", () => {
  it("書き換わっていなければ、そのまま", () => {
    const spot = spotDiff(thread(), of(BASE), BASE);
    expect(spot.state).toBe("untouched");
    expect(spot.index).toBe(1);
    expect(spot.added).toBe(0);
    expect(spot.removed).toBe(0);
  });

  it("指摘した文が書き換わっていれば、書き換え済み", () => {
    const head = BASE.replace("管理者のみ", "全ユーザー");
    const spot = spotDiff(thread(), of(head), BASE);
    expect(spot.state).toBe("rewritten");
    expect(spot.index).toBe(1);
    expect(spot.before).toBe("この機能は管理者のみが使えます。");
    expect(spot.removed).toBe("管理者のみ".length);
    expect(spot.added).toBe("全ユーザー".length);
  });

  it("指摘した文が残っていて周りだけ動いたら、周りが変更", () => {
    const head = BASE.replace(
      "この機能は管理者のみが使えます。",
      "この画面では管理者のみが使えます。",
    );
    const spot = spotDiff(thread(), of(head), BASE);
    expect(spot.state).toBe("around");
    expect(spot.index).toBe(1);
    expect(spot.added).toBeGreaterThan(0);
  });

  it("記法だけの違いは、画面に出る字で比べるので書き換えにしない", () => {
    // 強調が付いても、読む人にとっての字は変わらない。
    const head = BASE.replace("管理者のみ", "**管理者のみ**");
    const spot = spotDiff(thread(), of(head), BASE);
    expect(spot.state).toBe("untouched");
  });

  it("ブロックごと消えていれば、削除済み", () => {
    const head = "# 見出し\n\nあとの段落。\n";
    const spot = spotDiff(thread(), of(head), BASE);
    expect(spot.state).toBe("removed");
    expect(spot.before).toBe("この機能は管理者のみが使えます。");
    expect(spot.removed).toBe("この機能は管理者のみが使えます。".length);
    expect(loose(spot)).toBe(true);
  });

  it("見当たらなければ、近そうなブロックを挙げる", () => {
    const head = "# 見出し\n\nこの機能は管理者のみが使えるはずでした。\n";
    const spot = spotDiff(
      thread({ quote: "まったく別の文。", selection: "まったく別" }),
      of(head),
      head,
    );
    expect(spot.state).toBe("unknown");
    expect(spot.index).toBe(-1);
    expect(loose(spot)).toBe(true);
  });

  it("手掛かりも無ければ、候補を出さない", () => {
    const head = "# 見出し\n\nまるで関係の無い話。\n";
    const spot = spotDiff(
      thread({ quote: "この機能は管理者のみが使えます。" }),
      of(head),
      head,
    );
    expect(spot.state).toBe("unknown");
    expect(spot.candidates).toEqual([]);
  });

  it("版を引けなくても、今の本文に同じ文があれば居場所は出せる", () => {
    const spot = spotDiff(thread(), of(BASE), null);
    expect(spot.state).toBe("untouched");
    expect(spot.index).toBe(1);
    // 比べる相手が無いので、コメント時点の姿は持たない。
    expect(spot.before).toBeNull();
  });

  it("ブロック丸ごとへの指摘は、変われば書き換え済み", () => {
    const head = BASE.replace("使えます", "使えました");
    const spot = spotDiff(thread({ selection: "" }), of(head), BASE);
    expect(spot.state).toBe("rewritten");
  });

  it("絵文字 1 つの差し替えは ＋1 −1（サロゲートペアを 2 と数えない）", () => {
    const base = "顔は😀です。\n";
    const head = "顔は😃です。\n";
    const spot = spotDiff(
      thread({ quote: "顔は😀です。", selection: "です", selection_offset: 4 }),
      of(head),
      base,
    );
    expect(spot.state).toBe("around");
    expect(spot.added).toBe(1);
    expect(spot.removed).toBe(1);
  });
});

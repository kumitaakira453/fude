import { describe, expect, it } from "vitest";
import { splitBlocks } from "./blocks";
import type { ReviewThread } from "./review";
import { changesSince, loose, spotDiff, spotNote } from "./spotDiff";

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

  it("どの版にも見当たらなければ、当てにいかない", () => {
    // 語が重なる塊があっても寄せない。実台帳で外れた指摘は、どの版にも
    // 引用の文が無く、寄せ先を挙げても当たりようがなかった。
    const head = "# 見出し\n\nこの機能は管理者のみが使えるはずでした。\n";
    const spot = spotDiff(
      thread({ quote: "まったく別の文。", selection: "まったく別" }),
      of(head),
      head,
    );
    expect(spot.state).toBe("unknown");
    expect(spot.index).toBe(-1);
    expect(loose(spot)).toBe(true);
    // 控えは読めていた（指摘した時点の本文が残っていない側の言い方になる）。
    expect(spot.kept).toBe(true);
    expect(spotNote(spot)).toContain("取り込んだ指摘");
  });

  it("控えが残っていないときは、そう言う", () => {
    const spot = spotDiff(
      thread({ quote: "どこにも無い文。", selection: "どこにも無い" }),
      of("# 見出し\n\nまるで関係の無い話。\n"),
      null,
    );
    expect(spot.state).toBe("unknown");
    expect(spot.kept).toBe(false);
    expect(spotNote(spot)).toContain("基準版が残っていない");
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

describe("changesSince", () => {
  const base = "# 題\n\nはじめの段落。\n\nまんなかの段落。\n\nおわりの段落。\n";

  it("書き換わった塊を、今の番号で返す", () => {
    const head = "# 題\n\nはじめの段落。\n\nまんなかを直した。\n\nおわりの段落。\n";
    expect(changesSince(base, splitBlocks(head))).toEqual([
      { index: 2, kind: "changed", before: "まんなかの段落。" },
    ]);
  });

  it("足された塊と消えた塊を見分ける", () => {
    const head = "# 題\n\nはじめの段落。\n\n足した段落。\n\nまんなかの段落。\n";
    const got = changesSince(base, splitBlocks(head));
    expect(got).toContainEqual({ index: 2, kind: "added", before: null });
    expect(got).toContainEqual({ index: 4, kind: "removed", before: "おわりの段落。" });
  });

  it("何も変わっていなければ空", () => {
    expect(changesSince(base, splitBlocks(base))).toEqual([]);
  });
});

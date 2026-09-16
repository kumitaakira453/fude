import { describe, expect, it } from "vitest";
import { reviewPrompt, type ReviewThread, type ThreadFacts } from "./review";

// 写しはエージェントがそのまま読む。CLI（fude review list --format agent）と
// 同じ並びで、行・状態・現在の姿まで出ているかを見る。

function thread(over: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "a1b2c3d4",
    file: "/doc.md",
    quote: "この機能は管理者のみが使えます。",
    block_hash: "",
    selection: "管理者のみ",
    selection_offset: 5,
    section_path: ["設定", "保存"],
    base_version: "v1",
    status: { kind: "open" },
    comments: [
      { id: "c1", author: "you", body: "ここ直して", created_at: Date.now() },
    ],
    created_at: Date.now(),
    ...over,
  };
}

const facts = (over: Partial<ThreadFacts> = {}): ThreadFacts => ({
  where: "設定 › 保存",
  state: "書き換え済み",
  lines: { from: 42, to: 44 },
  head: "この機能は全ユーザーが使えます。",
  ...over,
});

describe("reviewPrompt", () => {
  it("件数・場所・行・状態・現在の姿・会話を並べる", () => {
    const text = reviewPrompt("見本.md", [thread()], () => facts());
    expect(text).toContain("見本.md\n未解決 1 件");
    expect(text).toContain("#a1b2c3d4  未対応  書き換え済み");
    expect(text).toContain("場所: 設定 › 保存");
    expect(text).toContain("位置: 42–44 行");
    expect(text).toContain("選択: 管理者のみ");
    expect(text).toContain("本文:\n> この機能は管理者のみが使えます。");
    expect(text).toContain("現在:\n> この機能は全ユーザーが使えます。");
    expect(text).toContain("- you (たった今): ここ直して");
  });

  it("1 行に収まる箇所は、行を 1 つだけ出す", () => {
    const text = reviewPrompt("見本.md", [thread()], () =>
      facts({ lines: { from: 7, to: 7 } }),
    );
    expect(text).toContain("位置: 7 行");
  });

  it("書き換わっていなければ、現在の姿は出さない", () => {
    const text = reviewPrompt("見本.md", [thread()], () =>
      facts({ state: "そのまま", head: null }),
    );
    expect(text).toContain("そのまま");
    expect(text).not.toContain("現在:");
  });

  it("本文から外れた指摘は、行の代わりにそう言う", () => {
    const text = reviewPrompt("見本.md", [thread()], () =>
      facts({ state: "本文から外れた", lines: null, head: null }),
    );
    expect(text).toContain("位置: 今の本文には無い");
  });

  it("突き合わせが済んでいなければ、そう言う", () => {
    const text = reviewPrompt("見本.md", [thread()], () => undefined);
    expect(text).toContain("#a1b2c3d4  未対応\n");
    expect(text).toContain("場所: 設定 › 保存");
    expect(text).toContain("位置: 突き合わせ前");
  });

  it("最後の書き込みが AI なら返信済みと出す", () => {
    const text = reviewPrompt(
      "見本.md",
      [
        thread({
          comments: [
            { id: "c1", author: "you", body: "ここ直して", created_at: 1 },
            { id: "c2", author: "AI", body: "直しました", created_at: 2 },
          ],
        }),
      ],
      () => facts(),
    );
    expect(text).toContain("#a1b2c3d4  返信済み");
    // AI の返事も会話に残す。何を言われて何をしたかが 1 件で読めるように。
    expect(text).toContain("- AI (");
  });

  it("選択がブロックぜんたいと同じときは、選択の行を出さない", () => {
    const text = reviewPrompt(
      "見本.md",
      [thread({ selection: "この機能は管理者のみが使えます。" })],
      () => facts(),
    );
    expect(text).not.toContain("選択:");
  });

  it("複数行のブロックは、全部の行に引用の印を付ける", () => {
    const text = reviewPrompt(
      "見本.md",
      [thread({ quote: "- ひとつ\n- ふたつ" })],
      () => facts({ head: null }),
    );
    expect(text).toContain("> - ひとつ\n> - ふたつ");
  });
});

describe("直したあとの手順", () => {
  it("返信と対応の記録の打ち方を、指摘の id 付きで添える", () => {
    const text = reviewPrompt("見本.md", [thread()], () => undefined);
    expect(text).toContain("直したら:");
    expect(text).toContain("fude review reply --thread <id>");
    expect(text).toContain('fude review commit --file "見本.md"');
    expect(text).toContain("--thread a1b2c3d4");
  });
});

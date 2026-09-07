import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import type { Block } from "../blocks";
import { diffBlocks, resolveInDiff, type Resolution } from "../blockDiff";
import { splitBlocks } from "../blocks";
import type { ReviewThread } from "../review";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import {
  anchorThreads,
  sectionPathTo,
  targetOfBlock,
  targetOfSpan,
} from "./reviewAnchors";

// 指摘を編集面の節点へ当てる。原文の突き合わせで決めるので、番号ではなく
// 「そのブロックの Markdown」が手がかり。

const SRC = `# 題

はじめの段落。

## 中の見出し

まんなかの段落。

おわりの段落。
`;

function opened(body: string) {
  const loaded = fromMarkdown(body);
  const state = EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });
  return { loaded, state };
}

function posOf(doc: EditorState["doc"], index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += doc.child(i).nodeSize;
  return at;
}

function thread(over: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "t1",
    file: "/doc.md",
    quote: "まんなかの段落。",
    block_hash: "",
    selection: "まんなか",
    selection_offset: 0,
    section_path: [],
    base_version: "v1",
    status: { kind: "open" },
    comments: [{ id: "c1", author: "you", body: "ここ", created_at: 1 }],
    created_at: 1,
    ...over,
  };
}

// 読むとき側と同じ道筋で「今どのブロックか」を出す。
function resolutionsOf(base: string, head: string, t: ReviewThread) {
  const diff = diffBlocks(splitBlocks(base), splitBlocks(head));
  return new Map<string, Resolution>([
    [t.id, resolveInDiff(diff, t.quote, t.selection)],
  ]);
}

const block = (index: number, src: string): Block => ({
  index,
  src,
  start: 0,
  end: src.length,
  type: "paragraph",
});

describe("anchorThreads", () => {
  it("原文がそのまま残っていればその節点に当てる", () => {
    const { loaded, state } = opened(SRC);
    const t = thread();
    const list = anchorThreads(
      state.doc,
      loaded,
      [t],
      resolutionsOf(SRC, SRC, t),
    );
    expect(list).toHaveLength(1);
    expect(list[0].pos).toBe(posOf(state.doc, 3));
    expect(list[0].moved).toBe(false);
    expect(list[0].guess).toBe(false);
  });

  it("書き換わっていれば書き換わった印を付ける", () => {
    const head = SRC.replace("まんなかの段落。", "まんなかの段落を少し直した。");
    const { loaded, state } = opened(head);
    const t = thread();
    const list = anchorThreads(
      state.doc,
      loaded,
      [t],
      resolutionsOf(SRC, head, t),
    );
    expect(list).toHaveLength(1);
    expect(list[0].pos).toBe(posOf(state.doc, 3));
    expect(list[0].moved).toBe(true);
  });

  it("居場所が決まらなければ引用を一番含む節点へ寄せる", () => {
    const { loaded, state } = opened(SRC);
    const t = thread();
    const list = anchorThreads(state.doc, loaded, [t], new Map([
      [t.id, { state: "unknown", index: -1 } as Resolution],
    ]));
    expect(list).toHaveLength(1);
    expect(list[0].pos).toBe(posOf(state.doc, 3));
    expect(list[0].guess).toBe(true);
    expect(list[0].moved).toBe(true);
  });

  it("引用をほぼ丸ごと含む節点が並ぶときは先頭へ寄せる", () => {
    // 読むとき側の mostSimilar と同じ扱い。逐語で当たったときと揃える。
    const body = `そっくりな段落のひとつ。\n\nそっくりな段落のふたつ。\n`;
    const { loaded, state } = opened(body);
    const t = thread({ quote: "そっくりな段落。", selection: "そっくりな段落" });
    const list = anchorThreads(state.doc, loaded, [t], new Map([
      [t.id, { state: "unknown", index: -1 } as Resolution],
    ]));
    expect(list).toHaveLength(1);
    expect(list[0].pos).toBe(0);
  });

  it("手がかりが無ければ当てない", () => {
    const { loaded, state } = opened(SRC);
    const t = thread({ quote: "どこにも無い文。", selection: "どこにも" });
    const list = anchorThreads(state.doc, loaded, [t], new Map([
      [t.id, { state: "unknown", index: -1 } as Resolution],
    ]));
    expect(list).toHaveLength(0);
  });

  it("同じ原文の節点が並ぶときは番号の近い方に当てる", () => {
    const body = `おなじ段落。\n\n間の段落。\n\nおなじ段落。\n`;
    const { loaded, state } = opened(body);
    const t = thread({ quote: "おなじ段落。", selection: "おなじ" });
    const list = anchorThreads(state.doc, loaded, [t], new Map([
      [t.id, { state: "unchanged", index: 2, head: block(2, "おなじ段落。") }],
    ]));
    expect(list[0].pos).toBe(posOf(state.doc, 2));
  });

  it("対応付けが済んでいない指摘は当てない", () => {
    const { loaded, state } = opened(SRC);
    expect(anchorThreads(state.doc, loaded, [thread()], new Map())).toHaveLength(0);
  });

  it("またいだ指摘は覆っているブロックの数を持つ", () => {
    const { loaded, state } = opened(SRC);
    const t = thread({
      quote: "まんなかの段落。\n\nおわりの段落。",
      selection: "まんなか",
    });
    const list = anchorThreads(
      state.doc,
      loaded,
      [t],
      resolutionsOf(SRC, SRC, t),
    );
    expect(list[0].covered).toBe(2);
  });

  it("打ったあとでも当て直せる", () => {
    const { loaded, state } = opened(SRC);
    const typed = state.apply(state.tr.insertText("あ", posOf(state.doc, 1) + 1));
    const t = thread();
    const list = anchorThreads(
      typed.doc,
      loaded,
      [t],
      resolutionsOf(SRC, SRC, t),
    );
    expect(list[0].pos).toBe(posOf(typed.doc, 3));
  });
});

describe("sectionPathTo", () => {
  it("手前の見出しを上から順に並べる", () => {
    const { state } = opened(SRC);
    expect(sectionPathTo(state.doc, posOf(state.doc, 3))).toEqual([
      "題",
      "中の見出し",
    ]);
  });

  it("先頭では空", () => {
    const { state } = opened(SRC);
    expect(sectionPathTo(state.doc, 0)).toEqual([]);
  });

  it("同じ深さの見出しは入れ替わる", () => {
    const body = `## あ\n\n段落。\n\n## い\n\n段落。\n`;
    const { state } = opened(body);
    expect(sectionPathTo(state.doc, posOf(state.doc, 3))).toEqual(["い"]);
  });
});

describe("targetOfSpan / targetOfBlock", () => {
  it("選んだ範囲から、そのブロックの Markdown と表示文字の位置を出す", () => {
    const { loaded, state } = opened(SRC);
    const at = posOf(state.doc, 3);
    // 「まんなかの段落。」の 3 文字目から 4 文字。
    const target = targetOfSpan(state.doc, loaded, "", at + 3, at + 7);
    expect(target?.pos).toBe(at);
    expect(target?.quote).toBe("まんなかの段落。");
    expect(target?.text).toBe("なかの段");
    expect(target?.offset).toBe(2);
    expect(target?.sectionPath).toEqual(["題", "中の見出し"]);
    expect(target?.source).toBe(SRC);
  });

  it("フロントマターは版の前に付け直す", () => {
    const { loaded, state } = opened(SRC);
    const at = posOf(state.doc, 3);
    const fm = "---\ntitle: あ\n---\n\n";
    expect(targetOfSpan(state.doc, loaded, fm, at + 1, at + 3)?.source).toBe(
      fm + SRC,
    );
  });

  it("ブロックをまたいだ範囲は、始まったブロックの終わりまでに丸める", () => {
    const { loaded, state } = opened(SRC);
    const at = posOf(state.doc, 3);
    const far = state.doc.content.size;
    const target = targetOfSpan(state.doc, loaded, "", at + 3, far);
    expect(target?.quote).toBe("まんなかの段落。");
    expect(target?.text).toBe("なかの段落。");
  });

  it("ブロック丸ごとは箇所を持たない", () => {
    const { loaded, state } = opened(SRC);
    const at = posOf(state.doc, 3);
    const target = targetOfBlock(state.doc, loaded, "", at);
    expect(target?.spot).toBe(null);
    expect(target?.text).toBe("");
    expect(target?.offset).toBe(0);
    expect(target?.quote).toBe("まんなかの段落。");
  });

  it("コードの塊も丸ごと対象にできる", () => {
    const body = "本文。\n\n```ts\nconst a = 1;\n```\n";
    const { loaded, state } = opened(body);
    const at = posOf(state.doc, 1);
    expect(targetOfBlock(state.doc, loaded, "", at)?.quote).toBe(
      "```ts\nconst a = 1;\n```",
    );
  });

  it("コードの塊の中を選んでも対象にできる", () => {
    const body = "本文。\n\n```ts\nconst a = 1;\n```\n";
    const { loaded, state } = opened(body);
    const at = posOf(state.doc, 1);
    const target = targetOfSpan(state.doc, loaded, "", at + 1, at + 6);
    expect(target?.pos).toBe(at);
    expect(target?.text).toBe("const");
    expect(target?.offset).toBe(0);
  });

  it("表のセルの中を選んでも、対象は表そのもの", () => {
    const body = "| a  | b  |\n| -- | -- |\n| 1  | 2  |\n";
    const { loaded, state } = opened(body);
    const target = targetOfSpan(state.doc, loaded, "", 5, 6);
    expect(target?.pos).toBe(0);
    expect(target?.quote).toBe(body.trimEnd());
  });
});

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
  posOfAnchor,
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

// 今の版に居場所はあるが、原文の綴りが画面側と揃っていない対応付け。
// exact() では当たらず、similar() へ落ちる。
function drifted(t: ReviewThread) {
  const src = `${t.quote}<!-- 綴りがずれた -->`;
  return new Map<string, Resolution>([
    [
      t.id,
      {
        state: "rewritten",
        index: 0,
        base: block(0, t.quote),
        head: block(0, src),
      },
    ],
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

  it("原文では引けないときは、引用を一番含む節点へ寄せる", () => {
    // 囲みの読み分けで綴りがずれると、原文の一致では当たらない。
    // その救済として似ている節点へ寄せる。
    const { loaded, state } = opened(SRC);
    const t = thread();
    const list = anchorThreads(state.doc, loaded, [t], drifted(t));
    expect(list).toHaveLength(1);
    expect(list[0].pos).toBe(posOf(state.doc, 3));
    expect(list[0].guess).toBe(true);
    expect(list[0].moved).toBe(true);
  });

  it("引用をほぼ丸ごと含む節点が並ぶときは寄せない", () => {
    // 読むとき側の mostSimilar と同じ扱い。どちらとも決められない。
    const body = `そっくりな段落のひとつ。\n\nそっくりな段落のふたつ。\n`;
    const { loaded, state } = opened(body);
    const t = thread({ quote: "そっくりな段落。", selection: "そっくりな段落" });
    expect(anchorThreads(state.doc, loaded, [t], drifted(t))).toHaveLength(0);
  });

  it("手がかりが無ければ当てない", () => {
    const { loaded, state } = opened(SRC);
    const t = thread({ quote: "どこにも無い文。", selection: "どこにも" });
    const list = anchorThreads(state.doc, loaded, [t], drifted(t));
    expect(list).toHaveLength(0);
  });

  it("本文から外れた指摘は、どこにも当てない", () => {
    // 消えた・見失った指摘を近そうな節点へ寄せると、関係の無い段落に
    // 指摘がぶら下がる。印はレビュー画面でだけ辿らせる。
    const { loaded, state } = opened(SRC);
    const t = thread();
    for (const gone of [
      { state: "unknown", index: -1 } as Resolution,
      { state: "removed", index: 3, base: block(3, "まんなかの段落。") } as Resolution,
    ]) {
      expect(anchorThreads(state.doc, loaded, [t], new Map([[t.id, gone]]))).toHaveLength(
        0,
      );
    }
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

  // 式は中身を持たない行内なので、そのままでは引用文から抜け落ちる。
  it("式を含む範囲は、原文の書き方のまま引用に入る", () => {
    const { loaded, state } = opened("計算は $E = mc^2$ です。\n");
    // 段落は 計算は(3) + 空白 + 式(1) + 空白 + です。(3)。
    expect(targetOfSpan(state.doc, loaded, "", 1, 10)?.text).toBe(
      "計算は $E = mc^2$ です。",
    );
    // ブロックの中での位置も同じ数え方で出す。
    const later = targetOfSpan(state.doc, loaded, "", 7, 10);
    expect(later?.text).toBe("です。");
    expect(later?.offset).toBe("計算は $E = mc^2$ ".length);
  });

  // 中身の無い項目は選んだ文字を持たない。引き先を残さないと、台帳の上では
  // ブロック全体への指摘と区別が付かなくなる。
  it("項目の中の範囲は、何番目の項目かを残す", () => {
    const list = "- さいしょ\n\n- [ ]\n\n- さいご\n";
    const { loaded, state } = opened(list);
    const at = posOf(state.doc, 0);
    // 3 つの項目それぞれの中を相手にする。位置は項目の段落の中。
    const marks: number[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph") marks.push(pos + 1);
      return true;
    });
    expect(marks).toHaveLength(3);
    expect(targetOfSpan(state.doc, loaded, "", marks[0], marks[0] + 2)?.unit).toEqual({
      kind: "item",
      index: 0,
    });
    // 中身が無い項目は範囲を作れないので、その次の項目で番号が飛ばないことを見る。
    expect(targetOfSpan(state.doc, loaded, "", marks[2], marks[2] + 2)?.unit).toEqual({
      kind: "item",
      index: 2,
    });
    expect(targetOfSpan(state.doc, loaded, "", marks[0], marks[0] + 2)?.pos).toBe(at);
  });

  it("項目の外の範囲は引き先を持たない", () => {
    const { loaded, state } = opened(SRC);
    const at = posOf(state.doc, 3);
    expect(targetOfSpan(state.doc, loaded, "", at + 3, at + 7)?.unit).toBeUndefined();
  });

  it("表のセルの中の範囲は、何番目のセルかを残す", () => {
    const table = "| あ | い |\n| - | - |\n| う | え |\n";
    const { loaded, state } = opened(table);
    const cells: number[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos + 1);
      return true;
    });
    expect(cells.length).toBe(4);
    expect(targetOfSpan(state.doc, loaded, "", cells[2], cells[2] + 1)?.unit).toEqual({
      kind: "cell",
      index: 2,
    });
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

describe("箇条書きの項目を対象にする", () => {
  const LIST = `- ひとつめ\n- ふたつめ\n- みつめ\n`;

  // 項目の中身の範囲。つまみのメニューが渡すもの。
  function itemSpan(state: EditorState, index: number) {
    const list = state.doc.child(0);
    let at = 1;
    for (let i = 0; i < index; i++) at += list.child(i).nodeSize;
    const item = list.child(index);
    return { from: at + 1, to: at + item.nodeSize - 1 };
  }

  it("相手はリストの塊で、範囲はその項目", () => {
    const { loaded, state } = opened(LIST);
    const span = itemSpan(state, 1);
    const target = targetOfSpan(state.doc, loaded, "", span.from, span.to);
    expect(target?.pos).toBe(0);
    expect(target?.quote).toBe(LIST.trimEnd());
    expect(target?.text).toBe("ふたつめ");
  });

  it("項目の位置は、リストの中の表示文字の位置になる", () => {
    const { loaded, state } = opened(LIST);
    const target = targetOfSpan(
      state.doc,
      loaded,
      "",
      itemSpan(state, 1).from,
      itemSpan(state, 1).to,
    );
    // 1 つめの「ひとつめ」（4 文字）の次から。
    expect(target?.offset).toBe(4);
  });

  it("最後の項目でも範囲が丸まらない", () => {
    const { loaded, state } = opened(LIST);
    const span = itemSpan(state, 2);
    expect(
      targetOfSpan(state.doc, loaded, "", span.from, span.to)?.text,
    ).toBe("みつめ");
  });
});

describe("posOfAnchor", () => {
  it("その id を持つ見出しの位置を返す", () => {
    const { state } = opened("## h1\n\n### h2\n\n本文\n\n### h23\n");
    const doc = state.doc;
    expect(posOfAnchor(doc, "h1")).toBe(0);
    expect(posOfAnchor(doc, "h2")).toBe(posOf(doc, 1));
    expect(posOfAnchor(doc, "h23")).toBe(posOf(doc, 3));
  });

  it("同じ見出しが並ぶときは、描くときと同じ連番で引く", () => {
    const { state } = opened("## 版\n\nあ\n\n## 版\n");
    expect(posOfAnchor(state.doc, "版")).toBe(0);
    expect(posOfAnchor(state.doc, "版-1")).toBe(posOf(state.doc, 2));
  });

  it("無い見出しは null", () => {
    const { state } = opened("## h1\n");
    expect(posOfAnchor(state.doc, "無い")).toBeNull();
  });
});

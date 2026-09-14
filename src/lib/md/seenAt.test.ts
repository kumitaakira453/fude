import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { blockActTr } from "./blockActs";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { schema } from "./schema";
import { seenAt } from "./seenAt";

// 上端に見えているブロックの控え。打っても同じブロックを指し続けることが肝。
// 位置で引いていたときは 1 文字打つと当たらなくなり、本文の先頭に落ちていた。

const SRC = `# 題

はじめの段落。

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

// 何番目のブロックがどこから始まるか。
function posOf(state: EditorState, index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += state.doc.child(i).nodeSize;
  return at;
}

describe("seenAt", () => {
  it("そのブロックの原文の先頭を返す", () => {
    const { loaded, state } = opened(SRC);
    for (let i = 0; i < state.doc.childCount; i++) {
      const id = state.doc.child(i).attrs.id as string;
      expect(seenAt(state.doc, loaded, posOf(state, i))?.at).toBe(
        loaded.ranges.get(id)![0],
      );
    }
  });

  it("ブロックの途中を指しても、そのブロックの頭を返す", () => {
    const { loaded, state } = opened(SRC);
    const at = posOf(state, 2);
    expect(seenAt(state.doc, loaded, at + 3)?.at).toBe(
      seenAt(state.doc, loaded, at)?.at,
    );
  });

  it("手前に字を打っても同じブロックを指す", () => {
    const { loaded, state } = opened(SRC);
    const want = seenAt(state.doc, loaded, posOf(state, 3))!;
    // はじめの段落の頭に 1 文字入れる。以降のブロックの位置は 1 ずれる。
    const typed = state.apply(state.tr.insertText("あ", posOf(state, 1) + 1));
    const now = seenAt(typed.doc, loaded, posOf(typed, 3));
    expect(now?.at).toBe(want.at);
    expect(now?.pos).toBe(posOf(typed, 3));
    // 位置で引く古い形では当たらない（これが先頭へ落ちていた原因）。
    expect(posOf(typed, 3)).not.toBe(want.pos);
  });

  it("足したばかりのブロックでは手前のブロックを控える", () => {
    const { loaded, state } = opened(SRC);
    const tr = blockActTr(state, posOf(state, 1), "insertAfter");
    const next = state.apply(tr!);
    // 足した分は目印を持たないので、原文の範囲を引けない。
    expect(next.doc.child(2).attrs.id).toBe(null);
    const seen = seenAt(next.doc, loaded, posOf(next, 2));
    const id = next.doc.child(1).attrs.id as string;
    expect(seen?.at).toBe(loaded.ranges.get(id)![0]);
    expect(seen?.pos).toBe(posOf(next, 1));
  });

  it("目印がどこにも無ければ控えない", () => {
    const { loaded, state } = opened("段落。\n");
    const bare = state.apply(
      state.tr.replaceWith(0, state.doc.content.size, [
        schema.nodes.paragraph.create(null, schema.text("目印の無い段落。")),
      ]),
    );
    expect(seenAt(bare.doc, loaded, 0)).toBe(null);
  });

  it("本文の外を指しても落ちない", () => {
    const { loaded, state } = opened(SRC);
    expect(seenAt(state.doc, loaded, 10_000)?.at).toBe(
      seenAt(state.doc, loaded, posOf(state, state.doc.childCount - 1))?.at,
    );
  });
});

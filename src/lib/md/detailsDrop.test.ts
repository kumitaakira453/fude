import type { Node as PmNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { blockActTr, blockMoveTr } from "./blockActs";
import { fromMarkdown } from "./fromMarkdown";
import { itemDropTr, itemIndexOf, itemOutTr } from "./listTree";
import { schema } from "./schema";
import { toMarkdown } from "./toMarkdown";

// トグルの中へ落とす・中から出す。
//
// ブロックも項目も相手を位置で指すので、本文の一番外の並びとトグルの中身は
// 同じ道を通る。見るのは書き戻した原文で、トグルの中身が二重にならない・
// 消えないことが肝。

const SRC = `前の段落

<details>
<summary>ひらく</summary>

中の段落

</details>

- 一つ
- 二つ
`;

function opened(body: string) {
  const loaded = fromMarkdown(body);
  return { loaded, state: EditorState.create({ doc: loaded.doc }) };
}

// 何番目の塊がどこから始まるか。
function posOf(doc: PmNode, index: number): number {
  let at = 0;
  for (let i = 0; i < Math.min(index, doc.childCount); i++) at += doc.child(i).nodeSize;
  return at;
}

// トグルの位置と、その中身の境目。中身の 0 番目は題なので、置けるのは 1 から。
function insideOf(doc: PmNode, index: number) {
  const at = posOf(doc, index);
  const details = doc.nodeAt(at)!;
  const slot = (n: number): number => {
    let pos = at + 1;
    for (let i = 0; i < n; i++) pos += details.child(i).nodeSize;
    return pos;
  };
  return { at, details, slot };
}

const listOf = (doc: PmNode): { pos: number; node: PmNode } => {
  let found: { pos: number; node: PmNode } | null = null;
  doc.descendants((node, pos) => {
    if (found || node.type !== schema.nodes.bulletList) return !found;
    found = { pos, node };
    return false;
  });
  return found!;
};

describe("トグルの中へ運ぶ", () => {
  it("外の箇条書きをトグルの中へ入れる", () => {
    const { loaded, state } = opened(SRC);
    const { slot } = insideOf(state.doc, 1);
    const tr = blockMoveTr(state, posOf(state.doc, 2), slot(2));
    const md = toMarkdown(state.apply(tr!).doc, loaded);
    expect(md).toBe(`前の段落

<details>
<summary>ひらく</summary>

中の段落

- 一つ
- 二つ

</details>
`);
  });

  it("題の前には置けない", () => {
    const { state } = opened(SRC);
    const { slot } = insideOf(state.doc, 1);
    expect(blockMoveTr(state, posOf(state.doc, 2), slot(0))).toBeNull();
  });

  it("トグル自身の中へは落とせない", () => {
    const { state } = opened(SRC);
    const { at, slot } = insideOf(state.doc, 1);
    expect(blockMoveTr(state, at, slot(1))).toBeNull();
  });

  it("トグルの中のものを外へ出す", () => {
    const { loaded, state } = opened(SRC);
    const { slot } = insideOf(state.doc, 1);
    const tr = blockMoveTr(state, slot(1), 0);
    const md = toMarkdown(state.apply(tr!).doc, loaded);
    expect(md.startsWith("中の段落\n\n前の段落\n")).toBe(true);
    // 中身が残ったまま外にも出る、とはならない。
    expect(md.match(/中の段落/g)).toHaveLength(1);
  });
});

describe("トグルの中の塊を操作する", () => {
  it("中の段落の下に足す", () => {
    const { loaded, state } = opened(SRC);
    const { slot } = insideOf(state.doc, 1);
    const tr = blockActTr(state, slot(1), "insertAfter");
    const next = state.apply(tr!);
    expect(next.doc.child(1).childCount).toBe(3);
    expect(toMarkdown(next.doc, loaded)).toContain("中の段落");
  });

  it("中身が 1 つだけなら、消しても空の段落が残る", () => {
    const { state } = opened(SRC);
    const { slot } = insideOf(state.doc, 1);
    const next = state.apply(blockActTr(state, slot(1), "delete")!);
    const details = next.doc.child(1);
    expect(details.type.name).toBe("details");
    expect(details.childCount).toBe(2);
    expect(details.child(1).type.name).toBe("paragraph");
    expect(details.child(1).content.size).toBe(0);
  });
});

describe("トグルの中の箇条書き", () => {
  const NESTED = `<details>
<summary>ひらく</summary>

- 一つ
  - 中
- 二つ

あとの段落

</details>
`;

  it("項目を並べ替えられる", () => {
    const { loaded, state } = opened(NESTED);
    const list = listOf(state.doc);
    const from = itemIndexOf(list.node, list.pos, list.pos + 1)!;
    const tr = itemDropTr(state, list.pos, from, 3, 0);
    expect(toMarkdown(state.apply(tr!).doc, loaded)).toBe(`<details>
<summary>ひらく</summary>

- 二つ
- 一つ
  - 中

あとの段落

</details>
`);
  });

  it("項目をトグルの中の別の場所へ出せる", () => {
    const { loaded, state } = opened(NESTED);
    const list = listOf(state.doc);
    const details = state.doc.child(0);
    // 「あとの段落」の後ろ（トグルの中の末尾）。
    const at = 1 + details.child(0).nodeSize + details.child(1).nodeSize + details.child(2).nodeSize;
    const tr = itemOutTr(state, list.pos, 2, at);
    expect(toMarkdown(state.apply(tr!).doc, loaded)).toBe(`<details>
<summary>ひらく</summary>

- 一つ
  - 中

あとの段落

- 二つ

</details>
`);
  });

  it("項目をトグルの外へ出せる", () => {
    const { loaded, state } = opened(NESTED);
    const list = listOf(state.doc);
    const tr = itemOutTr(state, list.pos, 2, state.doc.content.size);
    const md = toMarkdown(state.apply(tr!).doc, loaded);
    expect(md.trimEnd().endsWith("</details>\n\n- 二つ")).toBe(true);
    expect(md.match(/二つ/g)).toHaveLength(1);
  });
});

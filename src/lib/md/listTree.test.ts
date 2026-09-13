import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { depthRange, flatten, itemDropTr, itemIndexOf, itemOutTr } from "./listTree";
import { toMarkdown } from "./toMarkdown";

// 掴んだ項目を、別の位置・別の階層へ落とす。木を組み直すところだけを見る。

function open(body: string) {
  const loaded = fromMarkdown(body);
  const state = EditorState.create({ doc: loaded.doc });
  // 本文の 1 つ目の塊が並び。
  const list = state.doc.child(0);
  return { loaded, state, list, listPos: 0 };
}

const NEST = `- 一つ
  - 中
  - 奥
- 二つ
- 三つ
`;

// 項目の位置（本文に出てくる順）。
function itemPos(list: ReturnType<typeof open>["list"], listPos: number, n: number): number {
  let seen = 0;
  let at = -1;
  list.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.type.name !== "listItem") return true;
    if (seen++ === n) at = listPos + 1 + pos;
    return true;
  });
  return at;
}

function drop(body: string, from: number, slot: number, depth: number): string {
  const { loaded, state, listPos } = open(body);
  const tr = itemDropTr(state, listPos, from, slot, depth);
  if (!tr) return "（動かない）";
  return toMarkdown(state.apply(tr).doc, loaded);
}

describe("項目の列に開く", () => {
  it("入れ子は深さになる", () => {
    const { list } = open(NEST);
    expect(flatten(list).map((one) => [one.item.textContent, one.depth])).toEqual([
      ["一つ", 0],
      ["中", 1],
      ["奥", 1],
      ["二つ", 0],
      ["三つ", 0],
    ]);
  });

  it("項目の位置から何番目かを引ける", () => {
    const { list, listPos } = open(NEST);
    expect(itemIndexOf(list, listPos, itemPos(list, listPos, 2))).toBe(2);
  });
});

describe("落とせる深さの幅", () => {
  const flat = () => flatten(open(NEST).list);

  it("いちばん上の隙間は、いちばん外だけ", () => {
    expect(depthRange(flat(), 3, 0)).toEqual({ min: 0, max: 0 });
  });

  it("入れ子の項目のあいだなら、その深さまで入れる", () => {
    // 「中」と「奥」のあいだ。上が深さ 1 なので 2 まで、下が 1 なので 1 から。
    expect(depthRange(flat(), 3, 2)).toEqual({ min: 1, max: 2 });
  });

  it("いちばん下の隙間は、いちばん外まで浅くできる", () => {
    expect(depthRange(flat(), 3, 5)).toEqual({ min: 0, max: 1 });
  });
});

describe("落とす", () => {
  it("階層を変えずに上へ運ぶ", () => {
    expect(drop(NEST, 3, 0, 0)).toBe(`- 二つ
- 一つ
  - 中
  - 奥
- 三つ
`);
  });

  it("入れ子の中へ落とす", () => {
    expect(drop(NEST, 3, 2, 1)).toBe(`- 一つ
  - 中
  - 二つ
  - 奥
- 三つ
`);
  });

  it("その場で 1 段深くする", () => {
    expect(drop(NEST, 4, 4, 1)).toBe(`- 一つ
  - 中
  - 奥
- 二つ
  - 三つ
`);
  });

  it("子は連れていく", () => {
    expect(drop(NEST, 0, 5, 0)).toBe(`- 二つ
- 三つ
- 一つ
  - 中
  - 奥
`);
  });

  it("自分の中へは落とせない", () => {
    expect(drop(NEST, 0, 1, 1)).toBe("（動かない）");
  });

  it("動かず深さも変わらないなら何もしない", () => {
    expect(drop(NEST, 3, 3, 0)).toBe("（動かない）");
  });

  it("入れ子を浅くすると、後ろの項目は巻き込まれない", () => {
    expect(drop(NEST, 1, 1, 0)).toBe(`- 一つ
- 中
  - 奥
- 二つ
- 三つ
`);
  });

  it("番号付きの入れ子でも形が保たれる", () => {
    expect(drop("1. 一つ\n2. 二つ\n3. 三つ\n", 2, 0, 0)).toBe("1. 三つ\n2. 一つ\n3. 二つ\n");
  });
});

describe("並びの外へ出す", () => {
  // 前後に段落のある本文。並びは 2 番目の塊。
  const DOC = `前の段落

- 一つ
  - 中
- 二つ

後の段落
`;
  const out = (body: string, listIndex: number, from: number, block: number): string => {
    const loaded = fromMarkdown(body);
    const state = EditorState.create({ doc: loaded.doc });
    let at = 0;
    for (let i = 0; i < listIndex; i++) at += state.doc.child(i).nodeSize;
    const tr = itemOutTr(state, at, from, block);
    if (!tr) return "（動かない）";
    return toMarkdown(state.apply(tr).doc, loaded);
  };

  it("いちばん上へ出す。点のまま 1 つの並びになる", () => {
    expect(out(DOC, 1, 2, 0)).toBe(`- 二つ

前の段落

- 一つ
  - 中

後の段落
`);
  });

  it("いちばん下へ出す", () => {
    expect(out(DOC, 1, 2, 3)).toBe(`前の段落

- 一つ
  - 中

後の段落

- 二つ
`);
  });

  it("子は連れていく。深さはいちばん外に寄る", () => {
    expect(out(DOC, 1, 0, 0)).toBe(`- 一つ
  - 中

前の段落

- 二つ

後の段落
`);
  });

  it("並びが空になったら、その塊ごと消える", () => {
    expect(out("前の段落\n\n- ただ一つ\n\n後の段落\n", 1, 0, 0)).toBe(
      `- ただ一つ

前の段落

後の段落
`,
    );
  });

  it("元の場所の前後へ出すだけなら、並びの中の動きに譲る", () => {
    expect(out(DOC, 1, 2, 1)).toBe("（動かない）");
    expect(out(DOC, 1, 2, 2)).toBe("（動かない）");
  });

  it("隣が同じ種類の並びなら、そこへ繋ぐ", () => {
    const body = `- あ
- い

段落

- か
`;
    // 「い」を「か」の並びの手前（塊 2 の前）へ出す → 1 つの並びになる。
    expect(out(body, 0, 1, 2)).toBe(`- あ

段落

- い
- か
`);
  });
});

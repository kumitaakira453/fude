import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { itemActTr, itemMoveTr, itemSpotAt, type ItemAct } from "./itemActs";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 箇条書きの項目の操作。Markdown ではリスト全体が 1 ブロックだが、掴む単位は
// 項目に合わせる。入れ子はその項目の中にあるので、動かせば子も一緒に動く。

const SRC = `# 題

- 一つ
- 二つ
  - 二つの中
- 三つ

1. 甲
2. 乙

- [ ] やること
- [x] やったこと

おわり。
`;

function opened(body: string) {
  const loaded = fromMarkdown(body);
  const state = EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });
  return { loaded, state };
}

// 何番目のブロックのリストの、何番目の項目か。
function itemPos(state: EditorState, block: number, index: number) {
  let at = 0;
  for (let i = 0; i < block; i++) at += state.doc.child(i).nodeSize;
  const list = state.doc.child(block);
  let pos = at + 1;
  for (let i = 0; i < index; i++) pos += list.child(i).nodeSize;
  return { pos, listPos: at };
}

function act(block: number, index: number, a: ItemAct, body = SRC) {
  const { loaded, state } = opened(body);
  const { pos } = itemPos(state, block, index);
  const tr = itemActTr(state, pos, a);
  if (!tr) return null;
  const next = state.apply(tr);
  return { md: toMarkdown(next.doc, loaded), state: next };
}

function move(block: number, from: number, to: number) {
  const { loaded, state } = opened(SRC);
  const { listPos } = itemPos(state, block, 0);
  const tr = itemMoveTr(state, listPos, from, to);
  if (!tr) return null;
  return { md: toMarkdown(state.apply(tr).doc, loaded) };
}

// 箇条書きの行だけを取り出す。
const listOf = (md: string, marker: string) =>
  md.split("\n").filter((line) => line.trimStart().startsWith(marker)).join("\n");

describe("項目の位置から親のリストを引く", () => {
  it("リストの中の項目なら引ける", () => {
    const { state } = opened(SRC);
    const spot = itemSpotAt(state.doc, itemPos(state, 1, 1).pos);
    expect(spot?.index).toBe(1);
    expect(spot?.list.childCount).toBe(3);
  });

  it("リストの外は引けない", () => {
    const { state } = opened(SRC);
    expect(itemSpotAt(state.doc, 0)).toBeNull();
  });
});

describe("項目を足す", () => {
  it("前に足す", () => {
    const got = act(1, 0, "insertBefore");
    expect(listOf(got!.md, "-").split("\n").slice(0, 2)).toEqual(["-", "- 一つ"]);
  });

  it("後に足す", () => {
    const got = act(1, 1, "insertAfter");
    expect(got!.md).toContain("  - 二つの中\n-\n- 三つ");
  });

  it("足したところにカーソルが入る", () => {
    const got = act(1, 1, "insertAfter");
    const $at = got!.state.selection.$head;
    expect($at.parent.type.name).toBe("paragraph");
    expect($at.parent.textContent).toBe("");
  });

  it("チェックリストに足した項目はチェックの箱を持つ", () => {
    const got = act(3, 0, "insertAfter");
    // 中身が空のあいだ原文にはチェックが出ない（空のタスク項目は
    // Markdown で書けない）。編集モデルには残るので、字を入れれば出る。
    expect(got!.state.doc.child(3).child(1).attrs.checked).toBe(false);
    const state = got!.state;
    const typed = state.apply(state.tr.insertText("あ", state.selection.from));
    const { loaded } = opened(SRC);
    expect(toMarkdown(typed.doc, loaded)).toContain("- [ ] あ");
  });
});

describe("項目を複製する", () => {
  it("入れ子ごと下に写す", () => {
    const got = act(1, 1, "duplicate");
    expect(listOf(got!.md, "-")).toBe(
      [
        "- 一つ",
        "- 二つ",
        "  - 二つの中",
        "- 二つ",
        "  - 二つの中",
        "- 三つ",
        "- [ ] やること",
        "- [x] やったこと",
      ].join("\n"),
    );
  });

  it("番号は振り直される", () => {
    const got = act(2, 0, "duplicate");
    expect(got!.md).toContain("1. 甲\n2. 甲\n3. 乙");
  });
});

describe("項目を消す", () => {
  it("入れ子ごと消える", () => {
    const got = act(1, 1, "delete");
    expect(listOf(got!.md, "-").split("\n").slice(0, 2)).toEqual(["- 一つ", "- 三つ"]);
  });

  it("チェックリストの項目を消す", () => {
    const got = act(3, 1, "delete");
    expect(got!.md).toContain("- [ ] やること\n\nおわり。");
    expect(got!.md).not.toContain("やったこと");
  });

  it("最後の 1 つを消すとリストごと消える", () => {
    const got = act(0, 0, "delete", "- ただ一つ\n\nあと。\n");
    expect(got!.md).toBe("あと。\n");
  });

  it("本文がリストだけなら、書き続けられる段落が残る", () => {
    const got = act(0, 0, "delete", "- ただ一つ\n");
    expect(got!.md).toBe("\n");
    expect(got!.state.doc.child(0).type.name).toBe("paragraph");
  });
});

describe("項目を並べ替える", () => {
  it("末尾へ運ぶ", () => {
    const got = move(1, 0, 3);
    expect(listOf(got!.md, "-").split("\n").slice(0, 4)).toEqual([
      "- 二つ",
      "  - 二つの中",
      "- 三つ",
      "- 一つ",
    ]);
  });

  it("先頭へ運ぶ", () => {
    const got = move(1, 2, 0);
    expect(listOf(got!.md, "-").split("\n").slice(0, 4)).toEqual([
      "- 三つ",
      "- 一つ",
      "- 二つ",
      "  - 二つの中",
    ]);
  });

  it("同じ場所への運びは何もしない", () => {
    expect(move(1, 1, 1)).toBeNull();
    expect(move(1, 1, 2)).toBeNull();
  });

  it("範囲の外へは運べない", () => {
    expect(move(1, 0, 9)).toBeNull();
    expect(move(1, 9, 0)).toBeNull();
  });

  it("リストでないブロックは触らない", () => {
    const { state } = opened(SRC);
    expect(itemMoveTr(state, 0, 0, 2)).toBeNull();
  });
});

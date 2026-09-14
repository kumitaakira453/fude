import type { Node as PmNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { blockActTr, blockMoveTr, type BlockAct } from "./blockActs";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// ブロックの操作。見るのは書き戻した原文で、触っていないところが 1 文字も
// 変わらないことが肝。

const SRC = `# 題

はじめの段落。

- 一つ
- 二つ

| a  | b  |
| -- | -- |
| 1  | 2  |

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

// 操作は位置で受ける。番号のほうが読みやすいので、ここで引き直す。
// 並びの外の番号は、どこにも当たらない位置にする。
function posOf(doc: PmNode, index: number): number {
  if (index < 0) return -1;
  if (index > doc.childCount) return doc.content.size + 99;
  let at = 0;
  for (let i = 0; i < Math.min(index, doc.childCount); i++) at += doc.child(i).nodeSize;
  return at;
}

function act(body: string, index: number, a: BlockAct) {
  const { loaded, state } = opened(body);
  const tr = blockActTr(state, posOf(state.doc, index), a);
  if (!tr) return null;
  const next = state.apply(tr);
  return { md: toMarkdown(next.doc, loaded), state: next };
}

function move(body: string, from: number, to: number) {
  const { loaded, state } = opened(body);
  const tr = blockMoveTr(state, posOf(state.doc, from), posOf(state.doc, to));
  if (!tr) return null;
  const next = state.apply(tr);
  return { md: toMarkdown(next.doc, loaded), state: next };
}

// 表の行だけを取り出す。桁が保たれているかを見るのに使う。
const tableOf = (md: string) =>
  md.split("\n").filter((line) => line.startsWith("|")).join("\n");

describe("ブロックを足す", () => {
  it("上に足すと、間に空きが入る", () => {
    const got = act(SRC, 1, "insertBefore");
    expect(got!.md).toContain("# 題\n\n\n\nはじめの段落。");
  });

  it("下に足す", () => {
    const got = act(SRC, 1, "insertAfter");
    expect(got!.md).toContain("はじめの段落。\n\n\n\n- 一つ");
  });

  it("足したところにカーソルが入る", () => {
    const got = act(SRC, 1, "insertAfter");
    const $at = got!.state.selection.$head;
    expect($at.parent.type.name).toBe("paragraph");
    expect($at.parent.textContent).toBe("");
    expect($at.before(1)).toBe(posOf(got!.state.doc, 2));
  });
});

describe("ブロックを複製する", () => {
  it("下に置き、原文をそのまま写す", () => {
    const got = act(SRC, 1, "duplicate");
    expect(got!.md).toBe(SRC.replace("はじめの段落。", "はじめの段落。\n\nはじめの段落。"));
  });

  it("表を複製しても桁が変わらない", () => {
    const got = act(SRC, 3, "duplicate");
    expect(tableOf(got!.md)).toBe(
      [
        "| a  | b  |",
        "| -- | -- |",
        "| 1  | 2  |",
        "| a  | b  |",
        "| -- | -- |",
        "| 1  | 2  |",
      ].join("\n"),
    );
  });

  it("複製したブロックは目印を持たない", () => {
    const got = act(SRC, 1, "duplicate");
    const ids = [0, 1, 2, 3, 4, 5].map((i) => got!.state.doc.child(i).attrs.id);
    // 元（1 番目）は目印を持ち、写し（2 番目）は持たない。
    expect(ids[1]).toBeTruthy();
    expect(ids[2]).toBeNull();
  });
});

describe("ブロックを消す", () => {
  it("消したところの原文も抜ける", () => {
    const got = act(SRC, 1, "delete");
    expect(got!.md).toBe(SRC.replace("はじめの段落。\n\n", ""));
  });

  it("先頭を消す", () => {
    const got = act(SRC, 0, "delete");
    expect(got!.md).toBe(SRC.replace("# 題\n\n", ""));
  });

  it("末尾を消す", () => {
    const got = act(SRC, 4, "delete");
    expect(got!.md).toBe(SRC.replace("\nおわりの段落。\n", ""));
  });

  it("最後の 1 つを消すと、書き続けられる空の段落が残る", () => {
    const got = act("ひとつだけ。\n", 0, "delete");
    expect(got!.md).toBe("\n");
    expect(got!.state.doc.childCount).toBe(1);
    expect(got!.state.doc.child(0).type.name).toBe("paragraph");
  });

  it("無いブロックは触らない", () => {
    expect(act(SRC, 9, "delete")).toBeNull();
    expect(act(SRC, -1, "delete")).toBeNull();
  });
});

describe("ブロックを並べ替える", () => {
  it("後ろへ運ぶ。飛び越えた分の原文は増えない", () => {
    const got = move(SRC, 1, 4);
    expect(got!.md).toBe(
      [
        "# 題",
        "",
        "- 一つ",
        "- 二つ",
        "",
        "| a  | b  |",
        "| -- | -- |",
        "| 1  | 2  |",
        "",
        "はじめの段落。",
        "",
        "おわりの段落。",
        "",
      ].join("\n"),
    );
  });

  it("前へ運ぶ", () => {
    const got = move(SRC, 4, 1);
    expect(got!.md).toBe(
      [
        "# 題",
        "",
        "おわりの段落。",
        "",
        "はじめの段落。",
        "",
        "- 一つ",
        "- 二つ",
        "",
        "| a  | b  |",
        "| -- | -- |",
        "| 1  | 2  |",
        "",
      ].join("\n"),
    );
  });

  it("末尾へ運ぶ", () => {
    const got = move(SRC, 0, 5);
    expect(got!.md.trimEnd().endsWith("# 題")).toBe(true);
    expect(got!.md.startsWith("はじめの段落。")).toBe(true);
  });

  it("運んでいないブロックの桁は変わらない", () => {
    const got = move(SRC, 1, 4);
    expect(tableOf(got!.md)).toBe("| a  | b  |\n| -- | -- |\n| 1  | 2  |");
  });

  it("同じ場所への運びは何もしない", () => {
    expect(move(SRC, 1, 1)).toBeNull();
    expect(move(SRC, 1, 2)).toBeNull();
  });

  it("範囲の外へは運べない", () => {
    expect(move(SRC, 1, -1)).toBeNull();
    expect(move(SRC, 1, 9)).toBeNull();
    expect(move(SRC, 9, 1)).toBeNull();
  });
});

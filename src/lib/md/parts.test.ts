import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { blockActTr } from "./blockActs";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { toMarkdown, toMarkdownParts } from "./toMarkdown";

// 直列化の途中で、トップレベルの節点ごとの Markdown を拾う。
// 指摘の居場所を原文で突き合わせるための手がかり。

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

describe("toMarkdownParts", () => {
  it("全文は toMarkdown と同じ", () => {
    const { loaded, state } = opened(SRC);
    expect(toMarkdownParts(state.doc, loaded).text).toBe(
      toMarkdown(state.doc, loaded),
    );
  });

  it("節点の数だけ並び、位置は doc の並びと合う", () => {
    const { loaded, state } = opened(SRC);
    const { parts } = toMarkdownParts(state.doc, loaded);
    expect(parts).toHaveLength(state.doc.childCount);
    let at = 0;
    state.doc.forEach((node, _offset, index) => {
      expect(parts[index].pos).toBe(at);
      at += node.nodeSize;
    });
  });

  it("触っていない節点の Markdown は原文そのまま", () => {
    const { loaded, state } = opened(SRC);
    const { parts } = toMarkdownParts(state.doc, loaded);
    expect(parts[0].src).toBe("# 題");
    expect(parts[1].src).toBe("はじめの段落。");
    expect(parts[2].src).toBe("- 一つ\n- 二つ");
    expect(parts[3].src).toBe("| a  | b  |\n| -- | -- |\n| 1  | 2  |");
  });

  it("打った節点は組み直した分が入る", () => {
    const { loaded, state } = opened(SRC);
    // 「はじめの段落。」の頭に 1 文字入れる。
    const at = state.doc.child(0).nodeSize;
    const typed = state.apply(state.tr.insertText("あ", at + 1));
    const { parts } = toMarkdownParts(typed.doc, loaded);
    expect(parts[1].src).toBe("あはじめの段落。");
    // 触っていない節点は動かない。
    expect(parts[0].src).toBe("# 題");
    expect(parts[3].src).toBe("| a  | b  |\n| -- | -- |\n| 1  | 2  |");
  });

  it("足した節点も並びに入る", () => {
    const { loaded, state } = opened(SRC);
    const next = state.apply(blockActTr(state, 0, "insertAfter")!);
    const { parts } = toMarkdownParts(next.doc, loaded);
    expect(parts).toHaveLength(next.doc.childCount);
    expect(parts[1].src).toBe("");
    expect(parts[2].src).toBe("はじめの段落。");
  });

  it("消したあとも、残った節点の Markdown は原文のまま", () => {
    const { loaded, state } = opened(SRC);
    const next = state.apply(blockActTr(state, 1, "delete")!);
    const { text, parts } = toMarkdownParts(next.doc, loaded);
    expect(parts.map((p) => p.src)).not.toContain("はじめの段落。");
    expect(parts[0].src).toBe("# 題");
    // 全文は詰めた形で返る（parts は詰める前の切れ端なので、全文の
    // 位置ではなく「その節点の Markdown」として使う）。
    expect(text).toBe(toMarkdown(next.doc, loaded));
  });
});

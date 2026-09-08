import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins, unlistBack } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 項目の先頭で Backspace。点や番号だけを外して 1 段浅くする。
//
// 素の joinBackward は手前の項目へ中身を継ぎ足すので、飾りを外したいだけの
// ときに前の行と文がつながってしまう。

const SRC = `- 一つ
- 二つ
  - 中
- 三つ
`;

// その文で始まるテキストブロックの、いちばん頭の位置。
function headOf(doc: EditorState["doc"], text: string): number {
  let at = -1;
  doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isTextblock && node.textContent.startsWith(text)) at = pos + 1;
    return at < 0;
  });
  if (at < 0) throw new Error(`見つからない: ${text}`);
  return at;
}

// text の頭から offset 文字のところで Backspace を押す。
function back(text: string, body = SRC, offset = 0) {
  const loaded = fromMarkdown(body);
  const opened = EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });
  const at = headOf(opened.doc, text) + offset;
  const state = opened.apply(
    opened.tr.setSelection(TextSelection.create(opened.doc, at)),
  );
  const out: { next: EditorState | null } = { next: null };
  const ran = unlistBack(state, (tr) => {
    out.next = state.apply(tr);
  });
  return { ran, md: out.next ? toMarkdown(out.next.doc, loaded) : null };
}

describe("項目の先頭で Backspace", () => {
  it("いちばん外の項目は、箇条書きを抜けて段落に戻る", () => {
    expect(back("一つ").md).toBe(`一つ

- 二つ
  - 中
- 三つ
`);
  });

  it("入れ子の項目は 1 段だけ浅くなる", () => {
    expect(back("中").md).toBe(`- 一つ
- 二つ
- 中
- 三つ
`);
  });

  it("番号付きでも飾りが外れる", () => {
    expect(
      back(
        "乙",
        `1. 甲
2. 乙
`,
      ).md,
    ).toBe(`1. 甲

乙
`);
  });

  it("タスクの項目もチェックごと外れる", () => {
    expect(
      back(
        "やること",
        `- [ ] やること
- [x] やったこと
`,
      ).md,
    ).toBe(`やること

- [x] やったこと
`);
  });

  it("項目の途中では効かない", () => {
    expect(back("一つ", SRC, 1).ran).toBe(false);
  });

  // 同じ項目の 2 つ目の段落は、手前の段落へ継ぐのが正しい。飾りを外すと
  // 1 つ目の段落まで巻き込む。
  it("項目の 2 つ目の段落の先頭では効かない", () => {
    expect(
      back(
        "つづき",
        `- 一つ

  つづき
`,
      ).ran,
    ).toBe(false);
  });
});

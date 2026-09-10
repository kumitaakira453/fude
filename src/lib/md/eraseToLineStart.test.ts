import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins, eraseToLineStart } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// ⌘⌫。コードの塊の中では行の頭までを消す。
//
// 既定の動作に任せると DOM だけが書き換わって編集モデルとずれ、消したあと
// 塊へ入れ直せなくなる。塊の中では自分で消し、それ以外は既定へ渡す。

// text を含む行の、頭から offset 文字のところで ⌘⌫ を押す。
function erase(body: string, text: string, offset: number) {
  const loaded = fromMarkdown(body);
  const opened = EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });

  let at = -1;
  opened.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (!node.isTextblock) return true;
    const found = node.textContent.indexOf(text);
    if (found >= 0) at = pos + 1 + found + offset;
    return at < 0;
  });
  if (at < 0) throw new Error(`見つからない: ${text}`);

  const state = opened.apply(
    opened.tr.setSelection(TextSelection.create(opened.doc, at)),
  );
  const out: { next: EditorState | null } = { next: null };
  const ran = eraseToLineStart(state, (tr) => {
    out.next = state.apply(tr);
  });
  return { ran, md: out.next ? toMarkdown(out.next.doc, loaded) : null };
}

const CODE = `\`\`\`ts
const a = 1;
const b = 2;
\`\`\`
`;

describe("⌘⌫ で行の頭まで消す", () => {
  it("その行だけを消し、他の行は残す", () => {
    // 2 行目の末尾（"const b = 2;" の 12 文字目）で押す
    expect(erase(CODE, "const a = 1;", "const a = 1;\nconst b = 2;".length).md)
      .toBe(`\`\`\`ts
const a = 1;

\`\`\`
`);
  });

  it("1 行目でも、その行だけを消す", () => {
    expect(erase(CODE, "const a = 1;", "const a = 1;".length).md).toBe(`\`\`\`ts

const b = 2;
\`\`\`
`);
  });

  it("行の途中なら、そこから頭までを消す", () => {
    // "const " の後ろ（6 文字目）で押すと、残るのは "a = 1;"
    expect(erase(CODE, "const a = 1;", 6).md).toBe(`\`\`\`ts
a = 1;
const b = 2;
\`\`\`
`);
  });

  it("行の頭では消さないが、既定へも渡さない", () => {
    // 渡すと、ブラウザが塊の中を書き換えて編集モデルとずれる
    const { ran, md } = erase(CODE, "const a = 1;", 0);
    expect(ran).toBe(true);
    expect(md).toBeNull();
  });

  it("コードの塊の外は既定に任せる", () => {
    // 段落では、行の折り返しの頭がどこかを編集モデルからは決められない
    expect(erase("ふつうの段落です。\n", "ふつうの段落です。", 5).ran).toBe(false);
  });
});

import { chainCommands } from "prosemirror-commands";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { dropEmptyBack, editorPlugins, unlistBack } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 中身の無いブロックの先頭で Backspace。
//
// 既定に任せると、直前が囲み（callout・引用・箇条書き）だと、その最後の子と
// して今のブロックが差し込まれる。空のコードの塊が callout の中へ潜り、空の
// callout が箇条書きの項目に化けていた。空のブロックは消えるのが正しい。

// 中身の無いブロックのうち、上から n 番目の先頭で押す。
function drop(body: string, nth = 0) {
  const loaded = fromMarkdown(body);
  const opened = EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });

  let at = -1;
  let seen = 0;
  opened.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (!node.isTextblock) return true;
    if (node.content.size === 0 && seen++ === nth) at = pos + 1;
    return at < 0;
  });
  if (at < 0) throw new Error("空のブロックが無い");

  return run(opened, at, loaded);
}

// text で始まるブロックの中身を消してから、その先頭で押す
// （⌘⌫ で行を空にした直後の状態）。
function dropCleared(body: string, text: string, cmd: Command = dropEmptyBack) {
  const loaded = fromMarkdown(body);
  const opened = EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });
  let from = -1;
  let to = -1;
  opened.doc.descendants((node, pos) => {
    if (from >= 0) return false;
    if (!node.isTextblock) return true;
    if (node.textContent.startsWith(text)) {
      from = pos + 1;
      to = from + node.content.size;
    }
    return from < 0;
  });
  if (from < 0) throw new Error(`見つからない: ${text}`);
  return run(opened.apply(opened.tr.delete(from, to)), from, loaded, cmd);
}

// text を含むブロックの先頭で押す。
function dropAt(body: string, text: string) {
  const loaded = fromMarkdown(body);
  const opened = EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });
  let at = -1;
  opened.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (!node.isTextblock) return true;
    if (node.textContent.startsWith(text)) at = pos + 1;
    return at < 0;
  });
  if (at < 0) throw new Error(`見つからない: ${text}`);
  return run(opened, at, loaded);
}

function run(
  opened: EditorState,
  at: number,
  loaded: ReturnType<typeof fromMarkdown>,
  cmd: Command = dropEmptyBack,
) {
  const state = opened.apply(
    opened.tr.setSelection(TextSelection.create(opened.doc, at)),
  );
  const out: { next: EditorState | null } = { next: null };
  const ran = cmd(state, (tr) => {
    out.next = state.apply(tr);
  });
  return {
    ran,
    md: out.next ? toMarkdown(out.next.doc, loaded) : null,
    shape: out.next
      ? out.next.doc.children.map((n) => n.type.name)
      : null,
    // キャレットが落ち着いた先の字。前のブロックの末尾に来るのが期待。
    head: out.next
      ? out.next.doc.resolve(out.next.selection.from).parent.textContent
      : null,
  };
}

const CALLOUT_THEN_CODE = `<callout icon="⚙️">
愛うおえ
</callout>

\`\`\`
\`\`\`
`;

const EMPTY_CALLOUT = `1. Gaga
2. gaga

<callout icon="💡">
</callout>
`;

const LIST_THEN_TEXT = `1. Gaga
2. gaga

あとの段落
`;

describe("空のブロックを消す", () => {
  it("callout の直後の空の塊は、塊だけが消える", () => {
    const { ran, md, head } = drop(CALLOUT_THEN_CODE);
    expect(ran).toBe(true);
    expect(md).toBe(`<callout icon="⚙️">
愛うおえ
</callout>
`);
    // 直前のブロック（callout の中の段落）の末尾へ
    expect(head).toBe("愛うおえ");
  });

  it("空の callout は囲みごと消える", () => {
    const { ran, md, head } = drop(EMPTY_CALLOUT);
    expect(ran).toBe(true);
    expect(md).toBe(`1. Gaga
2. gaga
`);
    expect(head).toBe("gaga");
  });

  it("箇条書きの直後の空の段落は消え、最後の項目の末尾へ戻る", () => {
    const { ran, md, head } = dropCleared(LIST_THEN_TEXT, "あとの段落");
    expect(ran).toBe(true);
    expect(md).toBe(`1. Gaga
2. gaga
`);
    expect(head).toBe("gaga");
  });

  it("空の項目は消さず、今までどおり 1 段浅くなる", () => {
    // 実際の鍵の並びと同じ順で当てる（unlistBack が先）
    const { shape } = dropCleared(
      LIST_THEN_TEXT,
      "gaga",
      chainCommands(unlistBack, dropEmptyBack),
    );
    // 項目が消えるのではなく、箇条書きの外の段落として出てくる
    expect(shape).toEqual(["orderedList", "paragraph", "paragraph"]);
  });

  it("中身のあるブロックの行頭では何もしない", () => {
    expect(dropAt("あいう\n\nえおか\n", "えおか").ran).toBe(false);
  });

  it("文書にそれしか無ければ何もしない", () => {
    expect(drop("\n").ran).toBe(false);
  });
});

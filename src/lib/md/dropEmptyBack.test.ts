import { chainCommands } from "prosemirror-commands";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import {
  dropEmptyBack,
  editorPlugins,
  keepOutOfHolder,
  outEnter,
  outdentBack,
  toDetailsHead,
  unlistBack,
} from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 中身の無いブロックの先頭で Backspace。
//
// 既定に任せると、直前が囲み（callout・引用・箇条書き）だと、その最後の子と
// して今のブロックが差し込まれる。空のコードの塊が callout の中へ潜り、空の
// callout が箇条書きの項目に化けていた。空のブロックは消えるのが正しい。

// 中身の無いブロックのうち、上から n 番目の先頭で押す。
function drop(body: string, nth = 0, cmd: Command = dropEmptyBack) {
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

  return run(opened, at, loaded, cmd);
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

// トグルの中身の先頭で Backspace。囲みの外へ出し、見出しは残す。

function outdent(body: string, text: string, cmd: Command = outdentBack) {
  const loaded = fromMarkdown(body);
  const opened = EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });
  let at = -1;
  opened.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (!node.isTextblock) return true;
    if (node.textContent === text) at = pos + 1;
    return at < 0;
  });
  if (at < 0) throw new Error(`見つからない: ${text}`);
  return run(opened, at, loaded, cmd);
}

const TOGGLE = `<details>
<summary>トグル</summary>

Regagaga

</details>
`;

const TOGGLE_TWO = `<details>
<summary>トグル</summary>

Regagaga

あとの段落

</details>
`;

describe("トグルの外へ出す", () => {
  it("中身がひとつなら、空の囲みを残して外へ出す", () => {
    const { ran, md, shape } = outdent(TOGGLE, "Regagaga");
    expect(ran).toBe(true);
    // 見出しは残る
    expect(shape).toEqual(["details", "paragraph"]);
    expect(md).toBe(`<details>
<summary>トグル</summary>

</details>

Regagaga
`);
  });

  it("中身が残るなら、その塊だけを外へ出す", () => {
    const { ran, md, shape } = outdent(TOGGLE_TWO, "Regagaga");
    expect(ran).toBe(true);
    expect(shape).toEqual(["details", "paragraph"]);
    expect(md).toBe(`<details>
<summary>トグル</summary>

あとの段落

</details>

Regagaga
`);
  });

  it("2 つ目の塊の先頭では何もしない（手前の塊へ継ぐのが正しい）", () => {
    expect(outdent(TOGGLE_TWO, "あとの段落").ran).toBe(false);
  });

  it("引用や callout は触らない", () => {
    expect(outdent("> Regagaga\n", "Regagaga").ran).toBe(false);
    expect(outdent('<callout icon="💡">\nRegagaga\n</callout>\n', "Regagaga").ran).toBe(false);
  });
});

describe("囲みの中へ引きずり込まない", () => {
  const AFTER_TOGGLE = `<details>
<summary>トグル</summary>

中の文

</details>

あとの段落
`;

  it("トグルの後ろの段落は、押しても外に残る", () => {
    const { ran, md, shape } = outdent(AFTER_TOGGLE, "あとの段落", keepOutOfHolder);
    expect(ran).toBe(true);
    // 文書は動かない（カーソルが直前の字の末尾へ寄るだけ）
    expect(shape).toEqual(["details", "paragraph"]);
    expect(md).toBe(AFTER_TOGGLE);
  });

  it("引用や callout の後ろでも同じ", () => {
    for (const src of [
      "> 引用の文\n\nあとの段落\n",
      '<callout icon="💡">\n中の文\n</callout>\n\nあとの段落\n',
    ]) {
      const { ran, md } = outdent(src, "あとの段落", keepOutOfHolder);
      expect(ran).toBe(true);
      expect(md).toBe(src);
    }
  });

  it("空の塊は消す番に譲る", () => {
    const { ran } = dropCleared(AFTER_TOGGLE, "あとの段落", keepOutOfHolder);
    expect(ran).toBe(false);
  });

  it("囲みが先頭に無いときは、囲みごと項目へ押し込まない", () => {
    const src = '- 項目\n\n<callout icon="💡">\n中の文\n</callout>\n';
    const { ran, shape } = outdent(src, "中の文");
    expect(ran).toBe(true);
    // callout の中身が外へ出る（一覧の項目の中へ入らない）
    expect(shape).toEqual(["bulletList", "paragraph"]);
  });

  it("囲みが先頭に居るときは今までどおり", () => {
    expect(outdent("> 引用の文\n", "引用の文").ran).toBe(false);
  });
});

// 中身が空になってもトグルは残す。続けて押したら、見出しの入力欄へ移る。
describe("空のトグルは残す", () => {
  const EMPTY = `<details>
<summary>トグル</summary>

</details>
`;

  it("空の中身で押しても、囲みは消えない（見出しへ移る）", () => {
    const loaded = fromMarkdown(EMPTY);
    const state = EditorState.create({
      doc: loaded.doc,
      plugins: editorPlugins({ onSave: () => {} }),
    });
    // 中身の空の段落へカーソルを置く
    let at = -1;
    state.doc.descendants((node, pos) => {
      if (at < 0 && node.isTextblock) at = pos + 1;
    });
    const ready = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    // view を持たない呼び出しでは何もしない（入力欄が無いので移れない）
    expect(toDetailsHead(ready, undefined, undefined)).toBe(false);
    // 囲みを消す番には渡さない
    const shape = (s: typeof ready) => s.doc.children.map((n) => n.type.name);
    expect(shape(ready)).toEqual(["details"]);
  });
});

// 空になったトグルから下へ抜ける。囲みは残したまま、その下の行へ出る。
describe("空のトグルから下へ抜ける", () => {
  const EMPTY = `<details>
<summary>トグル</summary>

</details>

あとの段落
`;

  it("空の中身で Enter を押すと、囲みの下に行ができる", () => {
    const { ran, shape, md } = drop(EMPTY, 0, outEnter);
    expect(ran).toBe(true);
    // 囲みは残る
    expect(shape).toEqual(["details", "paragraph", "paragraph"]);
    // 出た先は空の行（打ち始めるところ）。原文では空行として出る。
    expect(md).toBe(`<details>
<summary>トグル</summary>

</details>



あとの段落
`);
  });

  it("すぐ下が空の行なら、行を積み増さない", () => {
    const src = `<details>
<summary>トグル</summary>

</details>

`;
    const { ran, shape } = drop(src, 0, outEnter);
    expect(ran).toBe(true);
    expect(shape).toEqual(["details", "paragraph"]);
  });

  it("中身が残っているときは、既定どおり行を増やす", () => {
    const src = `<details>
<summary>トグル</summary>

中の本文

</details>
`;
    // 空の塊が無いので、この道には来ない
    expect(() => drop(src, 0, outEnter)).toThrow();
  });
});

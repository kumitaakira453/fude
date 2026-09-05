// @vitest-environment jsdom
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { editorPlugins, markdownSlice } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 編集面をそのまま組み立てて、打鍵で試す。
//
// 規則だけを呼ぶ試験では、規則どうしの取り合いや、変換の直後の打ち消しのように
// 「順番」で決まる振る舞いが見えない。ProseMirror が打鍵を配る道筋
// （handleTextInput / handleKeyDown）を同じ形で呼んで、実際の組み合わせで確かめる。

// jsdom は描画を持たないので、位置を測る道具が無い。上下の行末の判定
// （view.endOfTextblock）がここで落ちるだけなので、空の測定結果を返しておく。
const noRects = () => [] as unknown as DOMRectList;
const noRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
if (!Element.prototype.getClientRects) Element.prototype.getClientRects = noRects;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = noRect;

let open: { view: EditorView; loaded: Loaded; place: HTMLElement } | null = null;

function editor(body: string) {
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({
      doc: loaded.doc,
      plugins: editorPlugins({ onSave: () => {} }),
    }),
  });
  open = { view, loaded, place };
  return view;
}

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
});

// 1 文字打つ。入力変換が拾わなければ、そのまま入れる。
function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    // 最後の引数は「その場に入る中身」を作る手。打鍵では呼ばれない。
    const took = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (!took) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

function press(view: EditorView, key: string, mods: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, ...mods });
  return view.someProp("handleKeyDown", (f) => f(view, event)) ?? false;
}

// n 番目の文字塊の末尾へカーソルを置く。
function caretAtEndOf(view: EditorView, nth: number) {
  let seen = 0;
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    if (seen++ === nth) at = pos + 1 + node.content.size;
  });
  if (at < 0) throw new Error("文字塊が足りない");
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);

describe("Enter で構造を続ける", () => {
  it("箇条書きの末尾で次の項目になる", () => {
    const view = editor("- あ\n- い\n");
    caretAtEndOf(view, 0);
    expect(press(view, "Enter")).toBe(true);
    type(view, "う");
    expect(source()).toBe("- あ\n- う\n- い\n");
  });

  it("番号付きの末尾で次の番号になる", () => {
    const view = editor("1. あ\n2. い\n");
    caretAtEndOf(view, 0);
    press(view, "Enter");
    type(view, "う");
    expect(source()).toBe("1. あ\n2. う\n3. い\n");
  });

  it("タスクの続きはタスクのまま、未了で始まる", () => {
    const view = editor("- [x] あ\n");
    caretAtEndOf(view, 0);
    press(view, "Enter");
    type(view, "い");
    expect(source()).toBe("- [x] あ\n- [ ] い\n");
  });

  it("表のセルでは下のセルへ移る", () => {
    const view = editor("| a | b |\n| --- | --- |\n| c | d |\n");
    caretAtEndOf(view, 0);
    expect(press(view, "Enter")).toBe(true);
    // 移った先はセルの頭。そこから書き始められる。
    type(view, "z");
    expect(source()).toBe("| a | b |\n| --- | --- |\n| zc | d |\n");
  });

  it("```lang を打って改行するとコードの塊になる", () => {
    const view = editor("本文\n");
    caretAtEndOf(view, 0);
    press(view, "Enter");
    type(view, "```python");
    press(view, "Enter");
    type(view, "x = 1");
    expect(source()).toBe("本文\n\n```python\nx = 1\n```\n");
  });
});

describe("変換した直後の Backspace で記号へ戻す", () => {
  it("~~ の取り消し線", () => {
    const view = editor("あ\n");
    caretAtEndOf(view, 0);
    type(view, "~~ここ~~");
    expect(view.state.doc.textContent).toBe("あここ");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.textContent).toBe("あ~~ここ~~");
  });

  it("** の強調", () => {
    const view = editor("あ\n");
    caretAtEndOf(view, 0);
    type(view, "**ここ**");
    expect(view.state.doc.textContent).toBe("あここ");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.textContent).toBe("あ**ここ**");
  });

  it("` の行内コード", () => {
    const view = editor("あ\n");
    caretAtEndOf(view, 0);
    type(view, "`if`");
    expect(view.state.doc.textContent).toBe("あif");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.textContent).toBe("あ`if`");
  });

  it("見出し", () => {
    const view = editor("あ\n\nい\n");
    caretAtEndOf(view, 1);
    press(view, "Enter");
    type(view, "## ");
    expect(view.state.doc.lastChild?.type.name).toBe("heading");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.lastChild?.type.name).toBe("paragraph");
  });

  it("- の箇条書き", () => {
    const view = editor("あ\n\nい\n");
    caretAtEndOf(view, 1);
    press(view, "Enter");
    type(view, "- ");
    expect(view.state.doc.lastChild?.type.name).toBe("bulletList");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(view.state.doc.lastChild?.textContent).toBe("- ");
  });

  it("1. の番号付き", () => {
    const view = editor("あ\n\nい\n");
    caretAtEndOf(view, 1);
    press(view, "Enter");
    type(view, "1. ");
    expect(view.state.doc.lastChild?.type.name).toBe("orderedList");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.lastChild?.type.name).toBe("paragraph");
  });

  it("> の引用", () => {
    const view = editor("あ\n\nい\n");
    caretAtEndOf(view, 1);
    press(view, "Enter");
    type(view, "> ");
    expect(view.state.doc.lastChild?.type.name).toBe("blockquote");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.lastChild?.type.name).toBe("paragraph");
  });

  it("--- の水平線", () => {
    const view = editor("あ\n\nい\n");
    caretAtEndOf(view, 1);
    press(view, "Enter");
    type(view, "---");
    expect(view.state.doc.lastChild?.type.name).toBe("thematicBreak");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.lastChild?.textContent).toBe("---");
  });

  it("``` のコードの塊", () => {
    const view = editor("あ\n\nい\n");
    caretAtEndOf(view, 1);
    press(view, "Enter");
    type(view, "```ts ");
    expect(view.state.doc.lastChild?.type.name).toBe("codeBlock");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.lastChild?.type.name).toBe("paragraph");
  });

  it("[題](url) のリンク", () => {
    const view = editor("あ\n");
    caretAtEndOf(view, 0);
    type(view, "[題](https://example.com)");
    expect(view.state.doc.textContent).toBe("あ題");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.textContent).toBe("あ[題](https://example.com)");
  });

  it("[ ] のタスク", () => {
    const view = editor("- あ\n");
    caretAtEndOf(view, 0);
    press(view, "Enter");
    type(view, "[ ] ");
    const item = () => view.state.doc.lastChild?.lastChild;
    expect(item()?.attrs.checked).toBe(false);
    expect(press(view, "Backspace")).toBe(true);
    expect(item()?.attrs.checked).toBe(null);
    expect(item()?.textContent).toBe("[ ] ");
  });

  it("* の斜め", () => {
    const view = editor("あ\n");
    caretAtEndOf(view, 0);
    type(view, "*ここ*");
    expect(view.state.doc.textContent).toBe("あここ");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.textContent).toBe("あ*ここ*");
  });

  it("選択が動いた後は字を消す側へ譲る", () => {
    const view = editor("あ\n");
    caretAtEndOf(view, 0);
    type(view, "~~ここ~~");
    // どこかを触ってから戻ってきた、という状況
    caretAtEndOf(view, 0);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    expect(press(view, "Backspace")).toBe(false);
  });
});

describe("Markdown を貼り付ける", () => {
  // 貼り付けは文字ではなく構造として入れる。文字のまま入れると、保存のときに
  // # や - が原文へ戻るように逃がされて「\#」の形になる。
  function paste(body: string, at: number, text: string) {
    const view = editor(body);
    caretAtEndOf(view, at);
    const slice = markdownSlice(text);
    if (!slice) throw new Error("読めなかった");
    view.dispatch(view.state.tr.replaceSelection(slice));
    return source();
  }

  it("見出しと箇条書きが構造になる", () => {
    const out = paste("あ\n", 0, "## 題\n\n- 一\n- 二\n");
    expect(out).toContain("## 題");
    expect(out).toContain("- 一");
    expect(out).not.toContain("\\#");
    expect(out).not.toContain("\\-");
  });

  it("表がそのまま表になる", () => {
    const out = paste("あ\n", 0, "| a | b |\n| --- | --- |\n| c | d |\n");
    expect(out).toContain("| --- | --- |");
    expect(out).not.toContain("\\|");
  });

  it("コードの塊は言語ごと入る", () => {
    const out = paste("あ\n", 0, "```python\nx = 1\n```\n");
    expect(out).toContain("```python");
  });

  it("段落 1 つなら書いている行の続きになる", () => {
    const out = paste("あ\n", 0, "**強い**");
    expect(out).toBe("あ**強い**\n");
  });

  it("貼り付けた分は原文の目印を持たない", () => {
    const slice = markdownSlice("## 題\n");
    expect(slice?.content.child(0).attrs.id).toBe(null);
  });
});

describe("セルの中の移動", () => {
  // jsdom では Mod は Ctrl になる（navigator.platform が空で mac と見なされない）。
  const modArrow = (view: EditorView, key: string) =>
    press(view, key, { ctrlKey: true });

  // <br> で 2 行に分かれたセル。doc > table > tr > td と入って、中身は 3 から。
  // 中身は text("ab") + <br> + text("cd")。
  const HEAD = 3;
  const LINE2 = HEAD + 3; // <br> の直後 = 2 行目の頭
  const TAIL = HEAD + 5; // "cd" の後ろ = 2 行目の末尾

  function cell() {
    const view = editor("| ab<br>cd | x |\n| --- | --- |\n| y | z |\n");
    // 2 行目の "c" と "d" の間
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, LINE2 + 1)),
    );
    return view;
  }

  it("⌘← はその行の頭まで（セルの頭ではない）", () => {
    const view = cell();
    expect(modArrow(view, "ArrowLeft")).toBe(true);
    expect(view.state.selection.from).toBe(LINE2);
  });

  it("⌘→ はその行の末尾まで", () => {
    const view = cell();
    expect(modArrow(view, "ArrowRight")).toBe(true);
    expect(view.state.selection.from).toBe(TAIL);
  });

  it("1 行目に居るときは 1 行目の端まで", () => {
    const view = cell();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, HEAD + 1)));
    expect(modArrow(view, "ArrowRight")).toBe(true);
    // <br> の手前で止まる。セルの末尾へは行かない。
    expect(view.state.selection.from).toBe(HEAD + 2);
  });

  it("上矢印で上のセルへ移る", () => {
    const view = editor("| a | b |\n| --- | --- |\n| c | d |\n");
    // 2 行目の左のセル
    caretAtEndOf(view, 2);
    expect(press(view, "ArrowUp")).toBe(true);
    // 戻る向きなので移動先の末尾に着く。
    type(view, "z");
    expect(source()).toBe("| az | b |\n| --- | --- |\n| c | d |\n");
  });

  it("下矢印で下のセルへ移る", () => {
    const view = editor("| a | b |\n| --- | --- |\n| c | d |\n");
    caretAtEndOf(view, 0);
    expect(press(view, "ArrowDown")).toBe(true);
    type(view, "z");
    expect(source()).toBe("| a | b |\n| --- | --- |\n| zc | d |\n");
  });

  it("一番下の行から下矢印で表の外へ出る", () => {
    const view = editor("| a | b |\n| --- | --- |\n| c | d |\n\nあと\n");
    // 2 行目の左のセル
    caretAtEndOf(view, 2);
    expect(press(view, "ArrowDown")).toBe(true);
    type(view, "z");
    // 右のセルへ移らず、表の後ろの段落に入る
    expect(source()).toBe("| a | b |\n| --- | --- |\n| c | d |\n\nzあと\n");
  });

  it("一番上の行から上矢印で表の外へ出る", () => {
    const view = editor("まえ\n\n| a | b |\n| --- | --- |\n| c | d |\n");
    // 表の 1 行目の左のセル
    caretAtEndOf(view, 1);
    expect(press(view, "ArrowUp")).toBe(true);
    type(view, "z");
    expect(source()).toBe("まえz\n\n| a | b |\n| --- | --- |\n| c | d |\n");
  });

  it("表の後ろに何も無ければ動かさない（右のセルへ逃げない）", () => {
    const view = editor("| a | b |\n| --- | --- |\n| c | d |\n");
    caretAtEndOf(view, 2);
    const at = view.state.selection.from;
    // 既定へ流さないので true。位置は動かない。
    expect(press(view, "ArrowDown")).toBe(true);
    expect(view.state.selection.from).toBe(at);
  });
});

describe("貼り付けた後の往復", () => {
  // 編集面に見えているものが、保存の文字列にそのまま出るか。
  // 出力を読み直して、節点の並びが編集面と一致することを確かめる。
  function shape(doc: import("prosemirror-model").Node): string[] {
    const out: string[] = [];
    doc.forEach((node) => out.push(node.type.name));
    return out;
  }

  function pasteAt(body: string, nth: number, text: string) {
    const view = editor(body);
    caretAtEndOf(view, nth);
    const slice = markdownSlice(text);
    if (!slice) throw new Error("読めなかった");
    view.dispatch(view.state.tr.replaceSelection(slice));
    const out = source();
    return { before: shape(view.state.doc), after: shape(fromMarkdown(out).doc), out };
  }

  const WHOLE = [
    "# 題",
    "",
    "本文と **強調**。",
    "",
    "| a | b |",
    "| --- | --- |",
    "| c | d |",
    "",
    "```python",
    "x = 1",
    "```",
    "",
    "---",
    "",
  ].join("\n");

  it("文書の途中に貼っても並びが変わらない", () => {
    const { before, after, out } = pasteAt("あ\n\nい\n\nう\n", 1, WHOLE);
    expect(after).toEqual(before);
    expect(out).toContain("x = 1");
  });

  it("文書の末尾に貼っても並びが変わらない", () => {
    const { before, after } = pasteAt("あ\n\nい\n", 1, WHOLE);
    expect(after).toEqual(before);
  });

  it("表の直後に貼っても並びが変わらない", () => {
    const body = "| a | b |\n| --- | --- |\n| c | d |\n\nあと\n";
    const { before, after } = pasteAt(body, 4, WHOLE);
    expect(after).toEqual(before);
  });

  it("先頭に貼っても並びが変わらない", () => {
    const { before, after } = pasteAt("あ\n\nい\n", 0, WHOLE);
    expect(after).toEqual(before);
  });
});

describe("ブロックを消す", () => {
  // 触っていないブロックは原文から出す仕組みなので、消したことが原文に
  // 伝わらないと本文が復活する。
  function drop(body: string, nth: number) {
    const view = editor(body);
    let from = 0;
    let to = 0;
    view.state.doc.forEach((node, offset, index) => {
      if (index !== nth) return;
      from = offset;
      to = offset + node.nodeSize;
    });
    view.dispatch(view.state.tr.delete(from, to));
    return source();
  }

  it("途中の段落", () => {
    expect(drop("あ\n\nい\n\nう\n", 1)).toBe("あ\n\nう\n");
  });

  it("先頭の段落", () => {
    expect(drop("あ\n\nい\n\nう\n", 0)).toBe("い\n\nう\n");
  });

  it("末尾の段落", () => {
    expect(drop("あ\n\nい\n\nう\n", 2)).toBe("あ\n\nい\n");
  });

  it("水平線", () => {
    expect(drop("あ\n\n---\n\nい\n", 1)).toBe("あ\n\nい\n");
  });

  it("表", () => {
    const body = "あ\n\n| a | b |\n| --- | --- |\n| c | d |\n\nい\n";
    expect(drop(body, 1)).toBe("あ\n\nい\n");
  });

  it("コードの塊", () => {
    expect(drop("あ\n\n```ts\nx\n```\n\nい\n", 1)).toBe("あ\n\nい\n");
  });
});

describe("水平線", () => {
  it("節点として選べない（横いっぱいの枠を出さない）", () => {
    const view = editor("あ\n\n---\n\nい\n");
    const hr = view.state.doc.child(1);
    expect(hr.type.name).toBe("thematicBreak");
    expect(NodeSelection.isSelectable(hr)).toBe(false);
  });

  it("後ろの行頭で Backspace すると記号が 1 つ減った段落になる", () => {
    const view = editor("あ\n\n---\n\nい\n");
    const at = view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.child(1).type.name).toBe("paragraph");
    // 3 本そろわないので、何も逃がさずに段落として書ける。
    expect(source()).toBe("あ\n\n--\n\nい\n");
    // カーソルは記号の末尾。ここから先は普段の 1 文字削除（画面側が行う）。
    const tail = view.state.doc.child(0).nodeSize + 1 + "--".length;
    expect(view.state.selection.from).toBe(tail);
    view.dispatch(view.state.tr.delete(tail - 1, tail));
    expect(view.state.doc.child(1).textContent).toBe("-");
    // 1 本だけの "-" は箇条書きの記号なので、原文では逃がされる。
    expect(source()).toBe("あ\n\n\\-\n\nい\n");
  });

  it("前の行末で Delete しても記号が 1 つ減る", () => {
    const view = editor("あ\n\n---\n");
    caretAtEndOf(view, 0);
    expect(press(view, "Delete")).toBe(true);
    expect(view.state.doc.child(1).type.name).toBe("paragraph");
    expect(view.state.doc.child(1).textContent).toBe("--");
  });

  it("見出しの先頭で Backspace すると飾りが外れる", () => {
    const view = editor("## 題\n");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.child(0).type.name).toBe("paragraph");
    expect(source()).toBe("題\n");
  });


});

describe("行内の装飾を外す", () => {
  // prosemirror-keymap は小文字で照合する（実機では keyCode から引き直すが、
  // 作った event には keyCode が無い）。
  const mod = (view: EditorView, key: string, shift = false) =>
    press(view, key, { ctrlKey: true, shiftKey: shift });

  it("行内コードの中にカーソルを置いて ⌘⇧C で囲みが外れる", () => {
    const view = editor("これは `if` です。\n");
    // "if" の中
    const at = "これは ".length + 1 + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    expect(mod(view, "c", true)).toBe(true);
    expect(source()).toBe("これは if です。\n");
  });

  it("装飾の末尾でも外せる（そこで打つと続くので同じ範囲）", () => {
    const view = editor("これは `if` です。\n");
    const at = "これは ".length + 1 + "if".length;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    expect(mod(view, "c", true)).toBe(true);
    expect(source()).toBe("これは if です。\n");
  });

  it("⌘B で太字が外れる", () => {
    const view = editor("これは **強い** です。\n");
    const at = "これは ".length + 2;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    expect(mod(view, "b")).toBe(true);
    expect(source()).toBe("これは 強い です。\n");
  });

  it("選んだ範囲に ⌘B で太字が付く", () => {
    const view = editor("ここを強くする\n");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 4, 6)),
    );
    expect(mod(view, "b")).toBe(true);
    expect(source()).toBe("ここを**強く**する\n");
  });

  it("装飾の外では次に打つ字へ効く（範囲は変えない）", () => {
    const view = editor("素の文\n");
    caretAtEndOf(view, 0);
    expect(mod(view, "b")).toBe(true);
    expect(source()).toBe("素の文\n");
    type(view, "太");
    expect(source()).toBe("素の文**太**\n");
  });
});

describe("コードの塊の中の Tab", () => {
  it("Tab で字下げが入る", () => {
    const view = editor("```ts\nx\n```\n");
    // コードの中の頭
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    expect(press(view, "Tab")).toBe(true);
    expect(source()).toBe("```ts\n    x\n```\n");
  });

  it("Shift-Tab で字下げが 1 段戻る", () => {
    const view = editor("```ts\n    x\n```\n");
    // "x" の直前
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)));
    expect(press(view, "Tab", { shiftKey: true })).toBe(true);
    expect(source()).toBe("```ts\nx\n```\n");
  });

  it("コードの外では表や箇条書きの働きを邪魔しない", () => {
    const view = editor("- あ\n- い\n");
    caretAtEndOf(view, 1);
    // 2 番目の項目を字下げする
    expect(press(view, "Tab")).toBe(true);
    expect(source()).toBe("- あ\n  - い\n");
  });
});

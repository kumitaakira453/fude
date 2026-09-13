// @vitest-environment jsdom
import type { Node as PmNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { DETAILS_HEAD, headLevelOf, headingHead, summaryOf, withSummary } from "./schema";
import { mathKey } from "./math";
import { SLASH_ITEMS, slashItems, slashKey } from "./slash";
import { toMarkdown } from "./toMarkdown";

// 編集面をそのまま組み立てて、打鍵で試す。view.test.ts と同じ土台。

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

function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection;
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

// 小窓は塊の先頭でしか出ない（canOpen）。字のある塊で試すときはここから。
function caretAtStartOf(view: EditorView, nth: number) {
  let seen = 0;
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    if (seen++ === nth) at = pos + 1;
  });
  if (at < 0) throw new Error("文字塊が足りない");
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);
const menu = () => document.querySelector(".mg-slash");
const state = (view: EditorView) => slashKey.getState(view.state);

// 節点の並びと、原文へ戻るときに効く attrs を控える。目印は読み直すと
// 振り直されるので見ない。
// 桁幅（widths）・区切り行（delim）・align は原文の書き方の控えなので見ない。
// 作った表は覚えておらず、読み直したものは原文から拾う。
const KEYS = [
  "level",
  "checked",
  "icon",
  "color",
  "head",
  "marker",
  "tight",
  "start",
  "lang",
  "header",
];

function sketch(doc: PmNode): string[] {
  const out: string[] = [];
  const walk = (node: PmNode, depth: number) => {
    const pad = "  ".repeat(depth);
    const attrs = KEYS.filter((key) => node.attrs[key] !== undefined && node.attrs[key] !== null)
      .map((key) => `${key}=${String(node.attrs[key])}`)
      .join(" ");
    out.push(`${pad}${node.type.name}${attrs ? ` [${attrs}]` : ""}`);
    if (node.isTextblock) {
      if (node.textContent) out.push(`${pad}  "${node.textContent}"`);
      return;
    }
    node.forEach((child) => walk(child, depth + 1));
  };
  doc.forEach((node) => walk(node, 0));
  return out;
}

// "あ" の後ろに空の段落を足し、そこで "/" と絞り込みを打つ。
function slash(query: string) {
  const view = editor("あ\n");
  caretAtEndOf(view, 0);
  press(view, "Enter");
  type(view, `/${query}`);
  return view;
}

describe("小窓を出す", () => {
  it("空の段落の先頭で出る", () => {
    const view = slash("");
    expect(state(view)).not.toBe(null);
    expect(menu()).not.toBe(null);
    expect(document.querySelectorAll(".mg-slash-row").length).toBe(SLASH_ITEMS.length);
  });

  it("見出しの先頭でも出る", () => {
    const view = editor("## 題\n");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    type(view, "/");
    expect(state(view)).not.toBe(null);
  });

  it("文の途中では出ない", () => {
    const view = editor("あ\n");
    caretAtEndOf(view, 0);
    type(view, "/");
    expect(state(view)).toBe(null);
    expect(menu()).toBe(null);
    expect(source()).toBe("あ/\n");
  });

  it("コードの塊の中では出ない", () => {
    const view = editor("```ts\nx\n```\n");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    type(view, "/");
    expect(state(view)).toBe(null);
    expect(source()).toBe("```ts\n/x\n```\n");
  });

  it("Escape で閉じて / が文字として残る", () => {
    const view = slash("");
    expect(press(view, "Escape")).toBe(true);
    expect(state(view)).toBe(null);
    expect(menu()).toBe(null);
    expect(source()).toBe("あ\n\n/\n");
  });

  it("該当が無くなったら閉じ、打った文字は残る", () => {
    const view = slash("zzz");
    expect(state(view)).toBe(null);
    expect(menu()).toBe(null);
    expect(source()).toBe("あ\n\n/zzz\n");
  });

  it("空白まで打ったら閉じる", () => {
    const view = slash("");
    type(view, " ");
    expect(state(view)).toBe(null);
  });

  it("↑↓ で選ぶ位置が動き、端で回り込む", () => {
    const view = slash("");
    expect(state(view)?.active).toBe(0);
    expect(press(view, "ArrowDown")).toBe(true);
    expect(state(view)?.active).toBe(1);
    press(view, "ArrowUp");
    press(view, "ArrowUp");
    expect(state(view)?.active).toBe(SLASH_ITEMS.length - 1);
  });
});

describe("絞り込み", () => {
  it("絞らなければ全部出る", () => {
    expect(slashItems("")).toHaveLength(SLASH_ITEMS.length);
  });

  // 打つのは英字の別名が主軸。指示された呼び方が先頭に来ること。
  const ENGLISH: [string, string][] = [
    ["text", "text"],
    ["p", "text"],
    ["paragraph", "text"],
    ["h1", "h1"],
    ["h2", "h2"],
    ["h3", "h3"],
    ["h4", "h4"],
    ["heading1", "h1"],
    ["heading3", "h3"],
    ["list", "bullet"],
    ["ul", "bullet"],
    ["bullet", "bullet"],
    ["ol", "ordered"],
    ["number", "ordered"],
    ["numbered", "ordered"],
    ["todo", "todo"],
    ["task", "todo"],
    ["check", "todo"],
    ["checkbox", "todo"],
    ["toggle", "toggle"],
    ["details", "toggle"],
    ["callout", "callout"],
    ["note", "callout"],
    ["table", "table"],
    ["hr", "rule"],
    ["divider", "rule"],
    ["line", "rule"],
  ];

  for (const [query, id] of ENGLISH) {
    it(`/${query} は ${id} が先頭に来る`, () => {
      expect(slashItems(query)[0]?.id).toBe(id);
    });
  }

  const JAPANESE: [string, string][] = [
    ["本文", "text"],
    ["見出し", "h1"],
    ["箇条書き", "bullet"],
    ["番号", "ordered"],
    ["タスク", "todo"],
    ["トグル", "toggle"],
    ["折りたたみ", "toggle"],
    ["コールアウト", "callout"],
    ["テーブル", "table"],
    ["表", "table"],
    ["区切り", "rule"],
  ];

  for (const [query, id] of JAPANESE) {
    it(`${query} は ${id} が先頭に来る`, () => {
      expect(slashItems(query)[0]?.id).toBe(id);
    });
  }

  it("h だけなら見出し 1〜4 が並ぶ", () => {
    expect(slashItems("h").slice(0, 4).map((item) => item.id)).toEqual([
      "h1",
      "h2",
      "h3",
      "h4",
    ]);
  });

  it("見出しは 4 つとも当たる", () => {
    expect(slashItems("見出し")).toHaveLength(4);
  });

  it("1 は見出し 1 が先頭に来る", () => {
    expect(slashItems("1")[0].id).toBe("h1");
  });

  it("当たらなければ空", () => {
    expect(slashItems("zzz")).toEqual([]);
  });
});

// 候補ごとに、決めたあとの原文と往復を確かめる。
const CASES: { id: string; query: string; want: string }[] = [
  { id: "text", query: "text", want: "あ\n\nい\n" },
  { id: "h1", query: "h1", want: "あ\n\n# い\n" },
  { id: "h2", query: "h2", want: "あ\n\n## い\n" },
  { id: "h3", query: "h3", want: "あ\n\n### い\n" },
  { id: "h4", query: "h4", want: "あ\n\n#### い\n" },
  { id: "bullet", query: "bullet", want: "あ\n\n- い\n" },
  { id: "ordered", query: "ol", want: "あ\n\n1. い\n" },
  { id: "todo", query: "todo", want: "あ\n\n- [ ] い\n" },
  {
    id: "toggle",
    query: "toggle",
    // 題から書き始める（打った字が題に入り、中身は空のまま）
    want: "あ\n\n<details>\n<summary>い</summary>\n\n</details>\n",
  },
  { id: "quote", query: "quote", want: "あ\n\n> い\n" },
  { id: "code", query: "codeblock", want: "あ\n\n```\nい\n```\n" },
  { id: "callout", query: "callout", want: 'あ\n\n<callout icon="💡">\nい\n</callout>\n' },
  // 絵文字は構造を作らない。盤を出すだけなので、本文は打った分だけになる。
  { id: "emoji", query: "emoji", want: "あ\n\nい\n" },
  {
    id: "table",
    query: "table",
    want: "あ\n\n| い | | |\n| - | - | - |\n| | | |\n| | | |\n",
  },
  { id: "rule", query: "hr", want: "あ\n\n---\n\nい\n" },
];

// 式は決めた後の続きが入力欄の側なので、本文へ打ち込む形の CASES では
// 追えない。下の「式」で別に見る。
const IN_BOX = new Set(["math", "mathBlock"]);

describe("決めた構造にする", () => {
  it("候補はすべて試している", () => {
    expect(CASES.map((c) => c.id)).toEqual(
      SLASH_ITEMS.filter((item) => !IN_BOX.has(item.id)).map((item) => item.id),
    );
  });

  for (const { id, query, want } of CASES) {
    it(`${id}: 狙いの構造になり、/ と絞り込みの文字が残らない`, () => {
      const view = slash(query);
      expect(slashItems(query).map((item) => item.id)).toEqual([id]);
      expect(press(view, "Enter")).toBe(true);
      expect(state(view)).toBe(null);
      expect(menu()).toBe(null);
      type(view, "い");
      expect(view.state.doc.textContent).not.toContain("/");
      expect(source()).toBe(want);
    });

    it(`${id}: 保存した文字列を読み直しても同じ形`, () => {
      const view = slash(query);
      press(view, "Enter");
      type(view, "い");
      expect(sketch(fromMarkdown(source()).doc)).toEqual(sketch(view.state.doc));
    });
  }
});

describe("テーブル", () => {
  // セルの並びを行ごとに読む。見出し行は 1 行目だけ。
  function grid(table: PmNode) {
    const rows: { header: boolean; text: string }[][] = [];
    table.forEach((row) => {
      const cells: { header: boolean; text: string }[] = [];
      row.forEach((cell) => {
        cells.push({ header: cell.attrs.header === true, text: cell.textContent });
      });
      rows.push(cells);
    });
    return rows;
  }

  it("3 行 × 3 列で、見出し行は 1 行目だけ", () => {
    const view = slash("table");
    press(view, "Enter");
    const table = view.state.doc.child(1);
    expect(table.type.name).toBe("table");
    expect(grid(table).map((row) => row.map((cell) => cell.header))).toEqual([
      [true, true, true],
      [false, false, false],
      [false, false, false],
    ]);
  });

  it("左上のセルから書き始められる", () => {
    const view = slash("table");
    press(view, "Enter");
    type(view, "い");
    expect(grid(view.state.doc.child(1))[0].map((cell) => cell.text)).toEqual(["い", "", ""]);
  });

  it("読み直しても 3 行 × 3 列のまま", () => {
    const view = slash("table");
    press(view, "Enter");
    type(view, "い");
    const back = fromMarkdown(source()).doc.child(1);
    expect(back.type.name).toBe("table");
    expect(grid(back)).toEqual(grid(view.state.doc.child(1)));
  });
});

describe("トグルの見出し", () => {
  it("打ち直したぶんが開きタグへ戻る", () => {
    const head = withSummary(DETAILS_HEAD, "決め方");
    expect(head).toBe("<details>\n<summary>決め方</summary>");
    expect(summaryOf(head)).toBe("決め方");
  });

  it("開きタグの属性と複数行の summary はそのまま残す", () => {
    const before = '<details open>\n<summary>\n  もとの題\n</summary>';
    const after = withSummary(before, "新しい題");
    expect(after).toBe("<details open>\n<summary>新しい題</summary>");
  });

  it("$ を含む見出しでも置き換えが壊れない", () => {
    expect(summaryOf(withSummary(DETAILS_HEAD, "$& と $1"))).toBe("$& と $1");
  });

  it("見出しトグルは、見出しのタグごと持って打ち直せる", () => {
    const head = headingHead(2, "決め方");
    expect(head).toBe("<details>\n<summary><h2>決め方</h2></summary>");
    expect(summaryOf(head)).toBe("決め方");
    expect(headLevelOf(head)).toBe(2);
    // 打ち直しても見出しのままでいる
    expect(withSummary(head, "決め直し")).toBe(
      "<details>\n<summary><h2>決め直し</h2></summary>",
    );
  });

  it("ただのトグルは見出しにならない", () => {
    expect(headLevelOf(DETAILS_HEAD)).toBeNull();
  });
});

describe("トグル要素", () => {
  it("段落の上で使うと、書きかけの字が中身に入り、題から書き始める", () => {
    const view = editor("Regagaga\n");
    caretAtStartOf(view, 0);
    type(view, "/トグル");
    press(view, "Enter");
    const node = view.state.doc.child(0);
    expect(node.type.name).toBe("details");
    expect(node.child(0).type.name).toBe("detailsSummary");
    expect(node.child(1).textContent).toBe("Regagaga");
    // カーソルは題の中
    expect(view.state.selection.$from.parent.type.name).toBe("detailsSummary");
    type(view, "題");
    expect(source()).toBe("<details>\n<summary>題</summary>\n\nRegagaga\n\n</details>\n");
  });

  it("見出しの上で使うと、その見出しが題になる", () => {
    const view = editor("## 決め方\n");
    caretAtStartOf(view, 0);
    type(view, "/トグル");
    press(view, "Enter");
    const node = view.state.doc.child(0);
    expect(node.type.name).toBe("details");
    expect(node.child(0).textContent).toBe("決め方");
    expect(node.child(0).attrs.level).toBe(2);
    // 中身は空から書き始める
    expect(node.child(1).textContent).toBe("");
    expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(source()).toBe("<details>\n<summary><h2>決め方</h2></summary>\n\n</details>\n");
  });

  it("題に打った字は <summary> に入る", () => {
    const view = editor("<details>\n<summary>トグル</summary>\n\n中の本文\n\n</details>\n");
    // 文字塊の 1 つ目は題
    caretAtEndOf(view, 0);
    expect(view.state.selection.$from.parent.type.name).toBe("detailsSummary");
    type(view, "！");
    expect(source()).toBe(
      "<details>\n<summary>トグル！</summary>\n\n中の本文\n\n</details>\n",
    );
  });

  it("題で `## ` と打つと見出しトグルになる", () => {
    const view = editor("<details>\n<summary></summary>\n\n中の本文\n\n</details>\n");
    caretAtEndOf(view, 0);
    type(view, "## ");
    type(view, "決め方");
    expect(view.state.doc.child(0).child(0).attrs.level).toBe(2);
    expect(source()).toBe(
      "<details>\n<summary><h2>決め方</h2></summary>\n\n中の本文\n\n</details>\n",
    );
  });

  it("開いた題で Enter を押すと、中身の先頭に行ができてそこへ入る", () => {
    const view = editor("<details>\n<summary>トグル</summary>\n\n中の本文\n\n</details>\n");
    caretAtEndOf(view, 0);
    press(view, "Enter");
    expect(view.state.selection.$from.parent.textContent).toBe("");
    expect(view.state.doc.child(0).childCount).toBe(3);
    // 題は割れない
    expect(view.state.doc.child(0).child(0).textContent).toBe("トグル");
    expect(view.state.doc.child(0).child(2).textContent).toBe("中の本文");
  });

  it("中身の先頭が空の行なら、足さずにそこへ入る", () => {
    const view = editor("<details>\n<summary>トグル</summary>\n\n\n</details>\n");
    caretAtEndOf(view, 0);
    press(view, "Enter");
    expect(view.state.doc.child(0).childCount).toBe(2);
    expect(view.state.selection.$from.parent.textContent).toBe("");
  });

  it("見出しトグルの題の頭で Backspace を押すと素のトグルへ戻る", () => {
    const view = editor(
      "<details>\n<summary><h2>決め方</h2></summary>\n\n中の本文\n\n</details>\n",
    );
    caretAtStartOf(view, 0);
    press(view, "Backspace");
    expect(view.state.doc.child(0).child(0).attrs.level).toBeNull();
    expect(source()).toBe(
      "<details>\n<summary>決め方</summary>\n\n中の本文\n\n</details>\n",
    );
  });

  it("見出しトグルは読み書きしても動かない", () => {
    const src = "<details>\n<summary><h2>決め方</h2></summary>\n\n中の本文\n\n</details>\n";
    const loaded = fromMarkdown(src);
    expect(toMarkdown(loaded.doc, loaded)).toBe(src);
    expect(loaded.doc.child(0).child(0).attrs.level).toBe(2);
  });
});

describe("テキストに戻す", () => {
  it("箇条書きの項目は外へ出る", () => {
    const view = editor("- あ\n");
    caretAtEndOf(view, 0);
    press(view, "Enter");
    type(view, "/text");
    press(view, "Enter");
    type(view, "い");
    expect(view.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(sketch(fromMarkdown(source()).doc)).toEqual(sketch(view.state.doc));
  });

  it("見出しは飾りが外れる", () => {
    const view = editor("## 題\n");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    type(view, "/text");
    expect(press(view, "Enter")).toBe(true);
    expect(view.state.doc.child(0).type.name).toBe("paragraph");
    expect(source()).toBe("題\n");
  });
});

describe("絵文字", () => {
  it("一覧に出て、別名でも当たる", () => {
    expect(slashItems("emoji").map((i) => i.id)).toContain("emoji");
    expect(slashItems("絵文字")[0]?.id).toBe("emoji");
  });
});

// 選んだ文字から出す帯も同じ一覧を使う。範囲を選んだまま押されるので、
// 「カーソルだけ」を要求すると押しても何も起きない。
describe("式", () => {
  it("/math では行内と塊の 2 つが並ぶ", () => {
    expect(slashItems("math").map((one) => one.id)).toEqual(["math", "mathBlock"]);
    expect(slashItems("式").map((one) => one.id)).toEqual(["math", "mathBlock"]);
  });

  it("インライン式は空の式を置き、そのまま中身を聞く", () => {
    const view = slash("inlinemath");
    expect(press(view, "Enter")).toBe(true);
    const at = mathKey.getState(view.state);
    expect(at).not.toBeNull();
    expect(view.state.doc.nodeAt(at!)?.type.name).toBe("inlineMath");
    // 中身が空のうちは書き出さない（囲みの記号だけが残ると原文が壊れる）。
    expect(source()).toBe("あ\n\n");
  });

  it("式ブロックは書きかけの無い塊を置き換える", () => {
    const view = slash("mathblock");
    expect(press(view, "Enter")).toBe(true);
    const at = mathKey.getState(view.state);
    expect(at).not.toBeNull();
    expect(view.state.doc.nodeAt(at!)?.type.name).toBe("mathBlock");
  });
});

describe("範囲を選んだままの変換", () => {
  const pick = (view: EditorView, from: number, to: number) => {
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)),
    );
  };
  const item = (id: string) => SLASH_ITEMS.find((one) => one.id === id)!;
  const kinds = ["h2", "bullet", "ordered", "todo", "quote", "code", "callout", "toggle"];

  for (const id of kinds) {
    it(`${id} に変えられ、選んだところは選んだまま`, () => {
      const view = editor("ここを変える\n");
      pick(view, 3, 5);
      expect(item(id).run(view.state, view.dispatch, view)).toBe(true);
      const { from, to } = view.state.selection;
      expect(view.state.doc.textBetween(from, to)).toBe("を変");
      expect(view.state.doc.textContent).toBe("ここを変える");
    });
  }

  it("テキストへ戻すと引用から出る", () => {
    const view = editor("> 引用の中\n");
    pick(view, 3, 5);
    expect(item("text").run(view.state, view.dispatch, view)).toBe(true);
    expect(view.state.doc.child(0).type.name).toBe("paragraph");
    expect(source()).toBe("引用の中\n");
  });

  // つまみのメニューは、この「効くかどうか」を押せる / 押せないに写している。
  it("表のセルの中では、どの変換も効かない", () => {
    const view = editor("| あ | い |\n| --- | --- |\n| 1 | 2 |\n");
    // 先頭のセルの中へカーソルを置く。
    let at = -1;
    view.state.doc.descendants((node, pos) => {
      if (at < 0 && node.type.name === "tableCell") at = pos + 1;
      return at < 0;
    });
    pick(view, at, at);
    const kinds = SLASH_ITEMS.filter((one) => !one.inserts);
    const works = kinds.filter((one) => one.run(view.state, undefined)).map((one) => one.id);
    expect(works).toEqual([]);
  });

  it("素の段落では、テキスト以外のどの変換も効く", () => {
    const view = editor("ここを変える\n");
    pick(view, 3, 5);
    const kinds = SLASH_ITEMS.filter((one) => !one.inserts);
    const dead = kinds.filter((one) => !one.run(view.state, undefined)).map((one) => one.id);
    // もともと素の段落なので「テキスト」だけが効かない。
    expect(dead).toEqual(["text"]);
  });

  it("入れるだけの項目には印が付いている（変換の一覧に出さない）", () => {
    const inserts = SLASH_ITEMS.filter((one) => one.inserts).map((one) => one.id);
    expect(inserts).toEqual(["emoji", "table", "math", "mathBlock", "rule"]);
  });
});

describe("並びどうしの付け替え", () => {
  const item = (id: string) => SLASH_ITEMS.find((one) => one.id === id)!;
  // つまみのメニューと同じ当て方。塊の中へカーソルを置いてから手を走らせる。
  const aim = (view: EditorView) => {
    view.dispatch(
      view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(1))),
    );
  };
  const change = (body: string, id: string) => {
    const view = editor(body);
    aim(view);
    const can = item(id).run(view.state, undefined);
    item(id).run(view.state, view.dispatch, view);
    return { can, out: source() };
  };

  it("箇条書きを TODO にすると、並びの項目すべてに印が付く", () => {
    expect(change("- あ\n- い\n", "todo")).toEqual({
      can: true,
      out: "- [ ] あ\n- [ ] い\n",
    });
  });

  it("TODO を箇条書きに戻すと、済みの印ごと落ちる", () => {
    expect(change("- [ ] あ\n- [x] い\n", "bullet")).toEqual({
      can: true,
      out: "- あ\n- い\n",
    });
  });

  it("点と番号を行き来できる", () => {
    expect(change("- あ\n- い\n", "ordered").out).toBe("1. あ\n2. い\n");
    expect(change("1. あ\n2. い\n", "bullet").out).toBe("- あ\n- い\n");
  });

  it("TODO から番号へ移すと、印は落ちる", () => {
    expect(change("- [ ] あ\n- [x] い\n", "ordered").out).toBe("1. あ\n2. い\n");
  });

  it("入れ子も含めて、塊まるごと変わる", () => {
    expect(change("- あ\n  - こ\n  - さ\n- い\n", "todo").out).toBe(
      "- [ ] あ\n  - [ ] こ\n  - [ ] さ\n- [ ] い\n",
    );
  });

  it("入れ子の項目にカーソルがあっても、塊まるごと変わる", () => {
    const view = editor("- あ\n  - こ\n- い\n");
    // 「こ」（入れ子の項目）へカーソルを置く。
    caretAtStartOf(view, 1);
    expect(item("todo").run(view.state, view.dispatch, view)).toBe(true);
    expect(source()).toBe("- [ ] あ\n  - [ ] こ\n- [ ] い\n");
  });

  it("番号への付け替えも入れ子まで届く", () => {
    expect(change("- あ\n  - こ\n- い\n", "ordered").out).toBe(
      "1. あ\n   1. こ\n2. い\n",
    );
  });

  it("TODO から戻すと、入れ子の印も落ちる", () => {
    expect(change("- [ ] あ\n  - [x] こ\n- [ ] い\n", "bullet").out).toBe(
      "- あ\n  - こ\n- い\n",
    );
  });

  it("同じ形への付け替えは効かない（押せない印になる）", () => {
    expect(change("- あ\n- い\n", "bullet").can).toBe(false);
    expect(change("1. あ\n", "ordered").can).toBe(false);
    expect(change("- [ ] あ\n", "todo").can).toBe(false);
  });
});

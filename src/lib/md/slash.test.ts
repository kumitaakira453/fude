// @vitest-environment jsdom
import type { Node as PmNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { DETAILS_HEAD, summaryOf, withSummary } from "./schema";
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

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);
const menu = () => document.querySelector(".mg-slash");
const state = (view: EditorView) => slashKey.getState(view.state);

// 節点の並びと、原文へ戻るときに効く attrs を控える。目印は読み直すと
// 振り直されるので見ない。
const KEYS = ["level", "checked", "icon", "color", "head", "marker", "tight", "start", "lang"];

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

  it("別名で当たる", () => {
    expect(slashItems("h1").map((item) => item.id)).toEqual(["h1"]);
    expect(slashItems("todo").map((item) => item.id)).toEqual(["todo"]);
    expect(slashItems("hr").map((item) => item.id)).toEqual(["rule"]);
    expect(slashItems("bullet").map((item) => item.id)).toEqual(["bullet"]);
    // "ul" は "rule" にも含まれるので、先頭に来ることだけを見る。
    expect(slashItems("ul")[0].id).toBe("bullet");
  });

  it("表示名で当たる", () => {
    expect(slashItems("区切").map((item) => item.id)).toEqual(["rule"]);
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
    want: "あ\n\n<details>\n<summary>トグル</summary>\n\nい\n\n</details>\n",
  },
  { id: "callout", query: "callout", want: 'あ\n\n<callout icon="💡">\nい\n</callout>\n' },
  { id: "rule", query: "hr", want: "あ\n\n---\n\nい\n" },
];

describe("決めた構造にする", () => {
  it("候補はすべて試している", () => {
    expect(CASES.map((c) => c.id)).toEqual(SLASH_ITEMS.map((item) => item.id));
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

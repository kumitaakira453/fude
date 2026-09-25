// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { TableView } from "./nodeViews";

// 表の包みへ付ける印（is-wide）を、ProseMirror が本文の書き換えと取り違えないこと。
// 取り違えると包みが描き直されて印が消え、付け直すたびにまた描き直す、を
// 止まらずに繰り返す。

const BODY = "| a | b |\n| --- | --- |\n| 1 | 2 |";

let view: EditorView | null = null;

function editor(withView: boolean) {
  const place = document.createElement("div");
  document.body.appendChild(place);
  view = new EditorView(place, {
    state: EditorState.create({ doc: fromMarkdown(BODY).doc }),
    nodeViews: withView ? { table: (node) => new TableView(node) } : {},
  });
  return view;
}

// ProseMirror は DOM の変化をまとめて後で読む。読み終わるまで待つ。
const settle = () => new Promise((done) => setTimeout(done, 20));

afterEach(() => {
  view?.destroy();
  view?.dom.parentElement?.remove();
  view = null;
});

describe("TableView", () => {
  it("包みに印を付けても描き直されない", async () => {
    const v = editor(true);
    const wrap = v.dom.querySelector(".mg-table-wrap")!;
    wrap.classList.add("is-wide");
    await settle();
    expect(v.dom.querySelector(".mg-table-wrap")).toBe(wrap);
    expect(wrap.classList.contains("is-wide")).toBe(true);
  });

  it("素の描き方では、包みに付けた印は描き直しで消える", async () => {
    const v = editor(false);
    const wrap = v.dom.querySelector(".mg-table-wrap")!;
    wrap.classList.add("is-wide");
    await settle();
    expect(v.dom.querySelector(".mg-table-wrap")?.classList.contains("is-wide")).toBe(false);
  });

  it("升目の中は今までどおり編集として読む", () => {
    const v = editor(true);
    expect(v.dom.querySelectorAll("td, th").length).toBeGreaterThan(0);
    expect(v.state.doc.textContent).toContain("12");
  });
});

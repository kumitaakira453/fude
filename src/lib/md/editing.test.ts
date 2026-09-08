// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { editingMark, markEditing } from "./editing";
import { schema } from "./schema";

// 打ち直しているところに付ける印。
//
// 行内の印は装飾の切れ目ごとに別の箱として描かれる。行内コードは自分の地と
// 余白を持つので、その途中で切ると札の半分だけ色が変わり、1 つの札が 2 つに
// 割れて見える。

// 請求データ（ + `SoftwareBillingSegment` + ）とアカウント
// 位置: 段落の中は 1 から。「請求データ（」は 6 文字なのでコードは 7..29。
const CODE_FROM = 7;
const CODE_TO = 29;

let view: EditorView | null = null;
let host: HTMLElement | null = null;

function opened() {
  const code = schema.marks.code.create();
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      schema.text("請求データ（"),
      schema.text("SoftwareBillingSegment", [code]),
      schema.text("）とアカウント"),
    ]),
  ]);
  host = document.createElement("div");
  document.body.appendChild(host);
  view = new EditorView(host, {
    state: EditorState.create({ doc, plugins: [editingMark] }),
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  host?.remove();
  view = null;
  host = null;
});

// 印の付いた箱ごとの中身。
const marked = () =>
  [...host!.querySelectorAll(".mg-editing")].map((el) => el.textContent);

describe("打ち直しの印", () => {
  it("行内コードの途中で終わる範囲は、札ごと覆う", () => {
    const v = opened();
    markEditing(v, { from: 1, to: CODE_FROM + 16 });
    expect(marked()).toEqual(["請求データ（", "SoftwareBillingSegment"]);
    // 札が半分だけ塗られていない。
    expect(host!.querySelectorAll("code").length).toBe(1);
  });

  it("行内コードの途中から始まる範囲も、札ごと覆う", () => {
    const v = opened();
    markEditing(v, { from: CODE_FROM + 16, to: CODE_TO + 3 });
    expect(marked()).toEqual(["SoftwareBillingSegment", "）とア"]);
  });

  it("札の外で終わる範囲はそのまま", () => {
    const v = opened();
    markEditing(v, { from: 1, to: CODE_FROM });
    expect(marked()).toEqual(["請求データ（"]);
  });

  it("印を外すと何も残らない", () => {
    const v = opened();
    markEditing(v, { from: 1, to: CODE_TO });
    expect(marked()).not.toEqual([]);
    markEditing(v, null);
    expect(marked()).toEqual([]);
  });
});

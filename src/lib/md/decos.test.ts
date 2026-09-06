import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { insideBlock } from "./nodeViews";
import { editorPlugins } from "./plugins";
import { focusedCell } from "./tableKeys";

// カーソルの居場所に付ける印は、行き先が変わらない限り作り直さない。
//
// ProseMirror は装飾が変わったかどうかを同一性で見る。中身が同じでも新しい
// 集合を返すと、その節点を描き直す。範囲を引いている間は選択の変化が毎フレーム
// 来るので、ここを作り直すと引っかかりになる。

function opened(body: string) {
  const loaded = fromMarkdown(body);
  return EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });
}

// その位置へカーソルを移す。
function moveTo(state: EditorState, pos: number) {
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, pos)),
  );
}

// 本文の中の、その文字列の直後の位置。
function after(state: EditorState, text: string) {
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at >= 0 || !node.isText || !node.text?.includes(text)) return;
    at = pos + node.text.indexOf(text) + text.length;
  });
  expect(at).toBeGreaterThanOrEqual(0);
  return at;
}

describe("居場所の印", () => {
  it("同じコードの塊の中を動く間は作り直さない", () => {
    const state = opened("```python\nx = 1\ny = 2\n```\n");
    const one = moveTo(state, after(state, "x = 1"));
    const two = moveTo(one, after(one, "y = 2"));
    expect(insideBlock.getState(one)).toBeDefined();
    expect(insideBlock.getState(one)?.find().length).toBe(1);
    expect(insideBlock.getState(two)).toBe(insideBlock.getState(one));
  });

  it("塊から出たら空になる", () => {
    const state = opened("```python\nx = 1\n```\n\nあとがき\n");
    const inside = moveTo(state, after(state, "x = 1"));
    const outside = moveTo(inside, after(inside, "あとがき"));
    expect(insideBlock.getState(inside)?.find().length).toBe(1);
    expect(insideBlock.getState(outside)?.find().length).toBe(0);
  });

  it("同じセルの中を動く間は作り直さない", () => {
    const state = opened("| 頭 | 次 |\n| --- | --- |\n| あいうえお | か |\n");
    const one = moveTo(state, after(state, "あいうえお") - 3);
    const two = moveTo(one, after(one, "あいうえお"));
    expect(focusedCell.getState(one)?.find().length).toBe(1);
    expect(focusedCell.getState(two)).toBe(focusedCell.getState(one));
  });

  it("隣のセルへ移ったら作り直す", () => {
    const state = opened("| 頭 | 次 |\n| --- | --- |\n| あい | かき |\n");
    const one = moveTo(state, after(state, "あい"));
    const two = moveTo(one, after(one, "かき"));
    const before = focusedCell.getState(one);
    const now = focusedCell.getState(two);
    expect(now).not.toBe(before);
    expect(now?.find()[0].from).not.toBe(before?.find()[0].from);
  });
});

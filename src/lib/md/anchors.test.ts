import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { anchorsKey } from "./anchors";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import type { Anchored } from "./reviewAnchors";

// 指摘の居場所を打っている間も保つ。当て直しは重いので、位置を写して繋ぐ。

const SRC = `はじめの段落。

まんなかの段落。

おわりの段落。
`;

function opened(body: string) {
  const loaded = fromMarkdown(body);
  return EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });
}

function posOf(doc: EditorState["doc"], index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += doc.child(i).nodeSize;
  return at;
}

function anchored(pos: number): Anchored {
  return { id: "t1", pos, covered: 1, moved: false, guess: false };
}

function put(state: EditorState, list: Anchored[]): EditorState {
  return state.apply(state.tr.setMeta(anchorsKey, list));
}

describe("anchors", () => {
  it("はじめは空", () => {
    expect(anchorsKey.getState(opened(SRC))).toEqual([]);
  });

  it("渡した居場所をそのまま持つ", () => {
    const state = opened(SRC);
    const at = posOf(state.doc, 1);
    expect(anchorsKey.getState(put(state, [anchored(at)]))).toEqual([
      anchored(at),
    ]);
  });

  it("手前に字を打つと位置が動く", () => {
    let state = opened(SRC);
    const at = posOf(state.doc, 1);
    state = put(state, [anchored(at)]);
    state = state.apply(state.tr.insertText("あ", 1));
    expect(anchorsKey.getState(state)?.[0].pos).toBe(at + 1);
  });

  it("後ろに打っても動かない", () => {
    let state = opened(SRC);
    const at = posOf(state.doc, 1);
    state = put(state, [anchored(at)]);
    state = state.apply(state.tr.insertText("あ", posOf(state.doc, 2) + 1));
    expect(anchorsKey.getState(state)?.[0].pos).toBe(at);
  });

  it("対象のブロックごと消えたら落ちる", () => {
    let state = opened(SRC);
    const at = posOf(state.doc, 1);
    state = put(state, [anchored(at)]);
    state = state.apply(
      state.tr.delete(at, at + state.doc.child(1).nodeSize),
    );
    expect(anchorsKey.getState(state)).toEqual([]);
  });

  it("動いていないときは同じものを返す", () => {
    let state = opened(SRC);
    state = put(state, [anchored(posOf(state.doc, 1))]);
    const was = anchorsKey.getState(state);
    state = state.apply(state.tr.insertText("あ", posOf(state.doc, 2) + 1));
    // 位置が変わらないなら控えを作り直さない（見ている側が測り直しに入る）。
    expect(anchorsKey.getState(state)).toBe(was);
  });

  it("空を渡せば消える", () => {
    let state = opened(SRC);
    state = put(state, [anchored(posOf(state.doc, 1))]);
    expect(anchorsKey.getState(put(state, []))).toEqual([]);
  });
});

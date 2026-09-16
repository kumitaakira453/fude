import { describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";
import { fromMarkdown } from "./fromMarkdown";
import { toMarkdown } from "./toMarkdown";
import { editorPlugins } from "./plugins";

// 打った記法がリンク・画像になるか。打鍵は入力変換の口へ 1 字ずつ通す
// （画面と同じ道）。

function typed(text: string) {
  const loaded = fromMarkdown("\n");
  let state = EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });
  for (const ch of text) {
    const from = state.selection.from;
    let done = false;
    for (const plugin of state.plugins) {
      const handler = plugin.props.handleTextInput;
      if (!handler) continue;
      const view = {
        state,
        dispatch: (tr: unknown) => {
          state = state.apply(tr as never);
          done = true;
        },
        composing: false,
      };
      if (handler.call(plugin, view as never, from, from, ch, () => state.tr)) {
        done = true;
        break;
      }
    }
    if (!done) state = state.apply(state.tr.insertText(ch, from, from));
  }
  return { state, loaded };
}

describe("打った記法", () => {
  it("[題](url) はリンクになる", () => {
    const { state } = typed("[ファイル](/レビュー見本/会話の見本.md#版)");
    const first = state.doc.child(0).child(0);
    expect(first.text).toBe("ファイル");
    expect(first.marks[0]?.type.name).toBe("link");
    expect(first.marks[0]?.attrs.href).toBe("/レビュー見本/会話の見本.md#版");
  });

  it("全角の括弧でもリンクになる（日本語入力のまま打ったとき）", () => {
    const { state } = typed("［ファイル］（/会話の見本.md#版）");
    const first = state.doc.child(0).child(0);
    expect(first.marks[0]?.type.name).toBe("link");
    expect(first.marks[0]?.attrs.href).toBe("/会話の見本.md#版");
  });

  it("![題](src) は画像になる", () => {
    const { state } = typed("![図](/透過の絵.png)");
    const node = state.doc.child(0).child(0);
    expect(node.type.name).toBe("image");
    expect(node.attrs.src).toBe("/透過の絵.png");
    expect(node.attrs.alt).toBe("図");
  });

  it("題つきのリンクも受ける", () => {
    const { state } = typed('[題](/a.md "説明")');
    expect(state.doc.child(0).child(0).marks[0]?.attrs.title).toBe("説明");
  });
});

describe("書き出し", () => {
  it("素の字のまま残った記法を、逃がしで殺さない", () => {
    // 入力変換が走らなかったときでも、書いた記法がそのまま保存され、
    // 次に読むときにリンクになる。
    const loaded = fromMarkdown("素の段落\n");
    const state = EditorState.create({
      doc: loaded.doc,
      plugins: editorPlugins({ onSave: () => {} }),
    });
    const tr = state.tr.insertText("[ファイル](/a.md#h2)", 1, 5);
    const out = toMarkdown(tr.doc, loaded);
    expect(out).toBe("[ファイル](/a.md#h2)\n");
    expect(fromMarkdown(out).doc.child(0).child(0).marks[0]?.type.name).toBe("link");
  });

  it("画像の記法も同じく残す", () => {
    const loaded = fromMarkdown("素の段落\n");
    const state = EditorState.create({
      doc: loaded.doc,
      plugins: editorPlugins({ onSave: () => {} }),
    });
    const tr = state.tr.insertText("![図](/a.png)", 1, 5);
    expect(toMarkdown(tr.doc, loaded)).toBe("![図](/a.png)\n");
  });
});

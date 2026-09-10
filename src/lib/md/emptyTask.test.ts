import { baseKeymap, chainCommands } from "prosemirror-commands";
import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins, splitItem } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 中身の無いタスク項目。
//
// GFM の印では書けない（`- [ ]` は印ではなく「[ ]」という字として読まれる）。
// 書き出す側は印を字として残し、読む側でタスク項目へ戻す。噛み合わせて
// 往復させる。噛み合っていないと、Enter で作った項目が素の点になる。

const trip = (src: string) => {
  const loaded = fromMarkdown(src);
  return toMarkdown(loaded.doc, loaded);
};

const boxes = (src: string) => {
  const out: (boolean | null)[] = [];
  fromMarkdown(src).doc.descendants((node) => {
    if (node.type.name === "listItem") out.push(node.attrs.checked);
    return true;
  });
  return out;
};

// text の末尾で Enter を押して書き出す（実物と同じ順で流す）。
const onEnter = chainCommands(splitItem, baseKeymap["Enter"]);
function enter(src: string, text: string) {
  const loaded = fromMarkdown(src);
  let state = EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isTextblock && node.textContent === text) {
      at = pos + 1 + text.length;
    }
    return at < 0;
  });
  if (at < 0) throw new Error(`見つからない: ${text}`);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
  const out: { next: EditorState | null } = { next: null };
  onEnter(state, (tr) => {
    out.next = state.apply(tr);
  });
  return toMarkdown((out.next ?? state).doc, loaded);
}

const LIST = `- [ ] TODO2
- [x] TODO1
- [ ] todolist
`;

describe("中身の無いタスク項目", () => {
  it("Enter で作った項目が素の点にならない", () => {
    expect(enter(LIST, "TODO2")).toBe(`- [ ] TODO2
- [ ]
- [x] TODO1
- [ ] todolist
`);
  });

  it("末尾でも同じ", () => {
    expect(enter(LIST, "todolist")).toBe(`- [ ] TODO2
- [x] TODO1
- [ ] todolist
- [ ]
`);
  });

  it("チェックの入った項目を割ったら、続きは未了から始める", () => {
    expect(enter(LIST, "TODO1")).toBe(`- [ ] TODO2
- [x] TODO1
- [ ]
- [ ] todolist
`);
  });

  it("印だけの項目は、空のタスク項目として読む", () => {
    expect(boxes("- [ ] a\n- [ ]\n- [x] b\n")).toEqual([false, false, true]);
    expect(boxes("- [x]\n")).toEqual([true]);
  });

  it("往復して同じものになる", () => {
    for (const src of [
      "- [ ] a\n- [ ]\n- [x] b\n",
      "- [x]\n",
      "- [ ] a\n- [ ] b\n",
      // 素の項目は素のまま（印が書かれていないものを勝手に変えない）
      "- a\n-\n- b\n",
    ]) {
      expect(trip(src)).toBe(src);
    }
  });

  it("印に見える字を書いただけの項目は変えない", () => {
    // 中身がある項目は、そのままの字として残る
    expect(trip("- [ ] のような書き方\n")).toBe("- [ ] のような書き方\n");
  });
});

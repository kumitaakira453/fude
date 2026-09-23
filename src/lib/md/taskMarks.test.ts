import { EditorState, TextSelection } from "prosemirror-state";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, parseTree } from "./fromMarkdown";
import { toMarkdown } from "./toMarkdown";
import { boxOf, DEFAULT_MARKS, readTaskMarks, setTaskMarks } from "./taskMarks";

// タスクの特殊な印。
//
// 原文は `- [/] やること` のまま置き、読むときに印として読み取る。字を落とした
// 分だけ位置も進めないと、選んだところから割り出す原文の位置がずれる。

afterEach(() => setTaskMarks(DEFAULT_MARKS));

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number } };
  data?: { box?: string };
}

// 木を読み取ったあとの、項目ごとの [印, 残った字, 字の始まる位置]。
function items(src: string): [string | null, string, number | undefined][] {
  const tree = parse(src);
  const out: [string | null, string, number | undefined][] = [];
  const walk = (node: Node) => {
    if (node.type === "listItem") {
      const text = (node.children?.[0]?.children?.[0] ?? {}) as Node;
      out.push([
        boxOf(node),
        text.value ?? "",
        text.position?.start.offset,
      ]);
    }
    node.children?.forEach(walk);
  };
  walk(tree);
  return out;
}

// fromMarkdown と同じ構成で読み、同じ直しを通す。
const parse = (src: string): Node => parseTree(src) as unknown as Node;

describe("印を読み取る", () => {
  it("字として書かれた印を項目へ移し、本文からは落とす", () => {
    expect(items("- [/] やること\n")).toEqual([["/", "やること", 6]]);
  });

  it("GFM の印も同じ場所へ移る", () => {
    expect(items("- [ ] まだ\n- [x] 済み\n").map((i) => i[0])).toEqual([" ", "x"]);
  });

  it("切ってある印は字のまま", () => {
    setTaskMarks([]);
    expect(items("- [/] やること\n")).toEqual([[null, "[/] やること", 2]]);
  });

  it("中身の無い項目も印として読む", () => {
    expect(items("- [-]\n").map((i) => [i[0], i[1]])).toEqual([["-", ""]]);
  });

  it("印に見えるだけの書き方は変えない", () => {
    // 閉じ括弧の後ろに空白が無いものは GFM も印として読まない。
    expect(items("- [/]やること\n")).toEqual([[null, "[/]やること", 2]]);
    // 行の途中は印ではない。
    expect(items("- これは [/] ではない\n")).toEqual([
      [null, "これは [/] ではない", 2],
    ]);
  });

  it("続きの行があっても、印だけを落とす（改行は残す）", () => {
    expect(items("- [/]\n  続き\n")).toEqual([["/", "\n続き", 5]]);
  });

  it("読み取る前の木には印が無い", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "listItem",
          children: [{ type: "paragraph", children: [{ type: "text", value: "[/] あ" }] }],
        },
      ],
    };
    expect(boxOf(tree.children[0])).toBeNull();
    readTaskMarks(tree);
    expect(boxOf(tree.children[0])).toBe("/");
  });
});

describe("往復", () => {
  const trip = (src: string) => {
    const loaded = fromMarkdown(src);
    return toMarkdown(loaded.doc, loaded);
  };

  it("触らなければ原文のまま", () => {
    for (const src of [
      "- [/] 進行中\n- [-] 取りやめ\n- [x] 済み\n",
      "- [/]\n",
      "- [ ] a\n  - [/] 子\n",
    ]) {
      expect(trip(src)).toBe(src);
    }
  });

  it("書き換えても印は残る", () => {
    const loaded = fromMarkdown("- [/] やること\n- [ ] つぎ\n");
    let state = EditorState.create({ doc: loaded.doc });
    let at = -1;
    state.doc.descendants((node, pos) => {
      if (at < 0 && node.isTextblock && node.textContent === "やること") {
        at = pos + 1 + node.textContent.length;
      }
      return at < 0;
    });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    state = state.apply(state.tr.insertText("を直す"));
    expect(toMarkdown(state.doc, loaded)).toBe("- [/] やることを直す\n- [ ] つぎ\n");
  });

  it("切ってある印は字のまま往復する", () => {
    setTaskMarks([]);
    expect(trip("- [/] やること\n")).toBe("- [/] やること\n");
  });
});

// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import type { Node as PmNode } from "prosemirror-model";
import { sinkListItem } from "prosemirror-schema-list";
import { EditorState, TextSelection } from "prosemirror-state";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Markdown } from "../../components/Markdown";
import { fromMarkdown } from "./fromMarkdown";
import { schema } from "./schema";
import { toMarkdown } from "./toMarkdown";
import { itemIntoToggleTr } from "./listTree";
import { itemAfterToggle, outOfToggleItem } from "./plugins";
import { SLASH_ITEMS } from "./slash";

// 箇条書きの段に並ぶトグル。同じ段の項目と同じ `- ` で始め、<details> だけを
// 持つ項目として書く（Notion では、その段に並ぶトグルのブロック）。
//
// 見るのは、項目の中のトグルとして読めることと、書き戻して同じ原文になること。

const EXAMPLE = `- 親要素X
  - 子要素A
  - <details>
    <summary>子要素B(トグル)</summary>

    子要素Bの詳細

    </details>
  - 子要素C
    - 孫要素C-1
- 親要素Y
`;

// 親要素 X の子の並びの、項目ごとの先頭の塊の種類。
function childKinds(doc: PmNode): string[] {
  const x = doc.firstChild?.firstChild;
  const sub = x?.child(1);
  if (!sub) return [];
  const out: string[] = [];
  sub.forEach((item) => out.push(item.firstChild?.type.name ?? ""));
  return out;
}

const roundTrip = (src: string) => {
  const loaded = fromMarkdown(src);
  return toMarkdown(loaded.doc, loaded);
};

describe("箇条書きの段に並ぶトグル（- <details>）", () => {
  it("子の項目の間に、トグルだけの項目として読む", () => {
    const { doc } = fromMarkdown(EXAMPLE);
    expect(childKinds(doc)).toEqual(["paragraph", "details", "paragraph"]);
    const toggle = doc.firstChild!.firstChild!.child(1).child(1).firstChild!;
    expect(toggle.child(0).type).toBe(schema.nodes.detailsSummary);
    expect(toggle.child(0).textContent).toBe("子要素B(トグル)");
    expect(toggle.child(1).textContent).toBe("子要素Bの詳細");
  });

  it("書き戻すと同じ原文になる", () => {
    expect(roundTrip(EXAMPLE)).toBe(EXAMPLE);
  });

  it("中にコードブロックがあっても、コードの中身に字下げを残さない", () => {
    const src = `- 主張
  - <details>
    <summary>根拠（\`a.py:1\`）</summary>

    \`\`\`python
    x = 1
    \`\`\`

    </details>
`;
    const { doc } = fromMarkdown(src);
    const toggle = doc.firstChild!.firstChild!.child(1).firstChild!.firstChild!;
    expect(toggle.type).toBe(schema.nodes.details);
    expect(toggle.child(1).type).toBe(schema.nodes.codeBlock);
    expect(toggle.child(1).textContent).toBe("x = 1");
    expect(roundTrip(src)).toBe(src);
  });

  it("字下げがタブでも、同じ並びに読む", () => {
    const tabbed = EXAMPLE.replace(/^ {4}/gm, "\t\t").replace(/^ {2}/gm, "\t");
    expect(childKinds(fromMarkdown(tabbed).doc)).toEqual(["paragraph", "details", "paragraph"]);
  });

  it("閉じの次の行に空行なしで次のトグルが続いても、開きを落とさない", () => {
    const src = `- <details>
  <summary>一つ目</summary>

  中身

  </details>
  <details open>
  <summary>二つ目</summary>

  </details>
- 次
`;
    const item = fromMarkdown(src).doc.firstChild!.firstChild!;
    const kinds: string[] = [];
    item.forEach((node) => kinds.push(node.type.name));
    expect(kinds).toEqual(["details", "details"]);
    expect(item.child(1).firstChild!.textContent).toBe("二つ目");
    expect(roundTrip(src)).toBe(src);
  });
});

describe("作る・描く", () => {
  it("書く面でトグルの題で Tab を押すと、この形で書き戻される", () => {
    const src = "- 主張\n- <details>\n  <summary>根拠</summary>\n\n  中身\n\n  </details>\n";
    const loaded = fromMarkdown(src);
    let at = -1;
    loaded.doc.descendants((node, pos) => {
      if (at < 0 && node.type === schema.nodes.detailsSummary) at = pos + 1;
      return true;
    });
    let state = EditorState.create({ doc: loaded.doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    let next = state;
    expect(sinkListItem(schema.nodes.listItem)(state, (tr) => (next = state.apply(tr)))).toBe(true);
    expect(toMarkdown(next.doc, loaded)).toBe(
      "- 主張\n  - <details>\n    <summary>根拠</summary>\n\n    中身\n\n    </details>\n",
    );
  });

  it("読む面では、項目の先頭の子がトグルになる（黒丸を消す CSS の当て先）", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <Provider store={createStore()}>
          <Markdown body={EXAMPLE} editorial={false} />
        </Provider>,
      ),
    );
    const items = host.querySelectorAll("li li");
    expect(items).toHaveLength(4);
    expect(items[1].firstElementChild?.tagName).toBe("DETAILS");
    expect(items[0].firstElementChild?.tagName).toBe("P");
    act(() => root.unmount());
    host.remove();
  });
});

describe("トグルの項目の次で Tab", () => {
  // 字の中へカーソルを置いて Tab の処理を通し、書き戻す。
  function tabAt(src: string, word: string): string | null {
    const loaded = fromMarkdown(src);
    let at = -1;
    loaded.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text === word) at = pos + 1;
      return true;
    });
    let state = EditorState.create({ doc: loaded.doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    const tr = itemIntoToggleTr(state);
    return tr ? toMarkdown(tr.doc, loaded) : null;
  }

  it("トグルの中身の末尾に、箇条書きとして入れる", () => {
    const src = "- A\n- <details>\n  <summary>根拠</summary>\n\n  中身\n\n  </details>\n- 新しい\n";
    expect(tabAt(src, "新しい")).toBe(
      "- A\n- <details>\n  <summary>根拠</summary>\n\n  中身\n\n  - 新しい\n\n  </details>\n",
    );
  });

  it("中身の最後が箇条書きなら、その末尾に足す", () => {
    const src =
      "- <details>\n  <summary>根拠</summary>\n\n  - 一つ\n\n  </details>\n- 二つ\n";
    expect(tabAt(src, "二つ")).toBe(
      "- <details>\n  <summary>根拠</summary>\n\n  - 一つ\n  - 二つ\n\n  </details>\n",
    );
  });

  it("前の項目がふつうの項目なら、何もしない（いつもの字下げに任せる）", () => {
    expect(tabAt("- A\n- B\n", "B")).toBeNull();
  });
});

describe("トグルの題で Enter", () => {
  // 字の中へカーソルを置いて Enter の処理を通す。
  function enterAt(src: string, word: string): EditorState | null {
    const loaded = fromMarkdown(src);
    let at = -1;
    loaded.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text === word) at = pos + word.length;
      return true;
    });
    let state = EditorState.create({ doc: loaded.doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    let next: EditorState | null = null;
    itemAfterToggle(state, (tr) => (next = state.apply(tr)));
    return next;
  }

  it("箇条書きの段のトグルなら、次の項目を作ってそこへ移る", () => {
    const src = "- <details>\n  <summary>根拠</summary>\n\n  中身\n\n  </details>\n- 次\n";
    const next = enterAt(src, "根拠")!;
    const list = next.doc.firstChild!;
    expect(list.childCount).toBe(3);
    expect(list.child(1).textContent).toBe("");
    expect(next.selection.$from.node(next.selection.$from.depth - 1)).toBe(list.child(1));
  });

  it("一番外のトグルでは何もしない（いつもの題の Enter に任せる）", () => {
    expect(enterAt("<details>\n<summary>根拠</summary>\n\n中身\n\n</details>\n", "根拠")).toBeNull();
  });
});

describe("項目をトグルに変える", () => {
  // 字の中へカーソルを置いて `/トグル要素` の処理を通し、書き戻す。
  function toggleAt(src: string, word: string): string {
    const loaded = fromMarkdown(src);
    let at = -1;
    loaded.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text === word) at = pos + 1;
      return true;
    });
    let state = EditorState.create({ doc: loaded.doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    const run = SLASH_ITEMS.find((i) => i.id === "toggle")!.run;
    let next = state;
    run(state, (tr) => (next = state.apply(tr)));
    return toMarkdown(next.doc, loaded);
  }

  it("チェックの項目なら、チェックを外して箇条書きの段のトグルにする", () => {
    const out = toggleAt("- [ ] A\n- [ ] B\n", "B");
    expect(out).toContain("\n- <details");
    expect(out).not.toContain("- [ ] <details");
    const { doc } = fromMarkdown(out);
    expect(doc.firstChild!.child(1).attrs.box).toBeNull();
  });

  it("チェックの項目の 2 つ目以降の塊なら、チェックは残す", () => {
    const loaded = fromMarkdown("- [ ] A\n\n  B\n");
    let state = EditorState.create({ doc: loaded.doc });
    let at = -1;
    loaded.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text === "B") at = pos + 1;
      return true;
    });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    let next = state;
    SLASH_ITEMS.find((i) => i.id === "toggle")!.run(state, (tr) => (next = state.apply(tr)));
    expect(next.doc.firstChild!.firstChild!.attrs.box).not.toBeNull();
  });
});

describe("トグルの閉じの後ろに続く塊", () => {
  it("空行なしで続く子の箇条書きを、字のままにせず項目として読む", () => {
    const src = "- <details open>\n  <summary>がが</summary>\n\n  </details>\n  - [ ] 子\n- 次\n";
    const item = fromMarkdown(src).doc.firstChild!.firstChild!;
    const kinds: string[] = [];
    item.forEach((node) => kinds.push(node.type.name));
    expect(kinds).toEqual(["details", "bulletList"]);
    const child = item.child(1).firstChild!;
    expect(child.attrs.box).toBe(" ");
    expect(child.textContent).toBe("子");
  });

  it("トグルの後ろに塊が続く項目は、閉じの後ろを空行で区切って書く", () => {
    const src = "- <details open>\n  <summary>がが</summary>\n\n  </details>\n  - [ ] 子\n- 次\n";
    const loaded = fromMarkdown(src);
    // 手を入れた項目として書かせる（原文の写しを使わせない）。
    const fresh = EditorState.create({ doc: loaded.doc });
    const out = toMarkdown(fresh.doc, { ...loaded, originals: new Map(), spans: new Map(), ranges: new Map() });
    expect(out).toContain("</details>\n\n  - [ ] 子");
    const again = fromMarkdown(out).doc.firstChild!.firstChild!;
    expect(again.child(1).firstChild!.attrs.box).toBe(" ");
  });
});

describe("箇条書きの段のトグルの中身から出る", () => {
  // 中身の最後の空の行にカーソルを置いて、出る処理を通す。
  function outIn(doc: PmNode): EditorState | null {
    let at = -1;
    doc.descendants((node, pos) => {
      if (node.type === schema.nodes.details) at = pos + node.nodeSize - 2;
      return true;
    });
    let state = EditorState.create({ doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    let next: EditorState | null = null;
    outOfToggleItem(state, (tr) => (next = state.apply(tr)));
    return next;
  }
  const outAt = (src: string) => outIn(fromMarkdown(src).doc);

  it("中身の最後の空の行から、トグルの項目の次の項目へ出る", () => {
    // 中身「中身」の後ろに空の行を足した形（書き戻すと空の行は落ちるので doc で組む）。
    const { doc } = fromMarkdown("- <details>\n  <summary>題</summary>\n\n  中身\n\n  </details>\n- 次\n");
    let end = -1;
    doc.descendants((node, pos) => {
      if (node.type === schema.nodes.details) end = pos + node.nodeSize - 1;
      return true;
    });
    const withLine = EditorState.create({ doc }).tr.insert(end, schema.nodes.paragraph.create()).doc;
    const out = outIn(withLine)!;
    const items = out.doc.firstChild!;
    expect(items.childCount).toBe(3);
    expect(items.child(0).childCount).toBe(1);
    expect(items.child(0).firstChild!.childCount).toBe(2);
    expect(items.child(1).textContent).toBe("");
    expect(out.selection.$from.node(out.selection.$from.depth - 1)).toBe(items.child(1));
  });

  it("中身が空の行だけなら、行は残して次の項目へ出る", () => {
    const out = outAt("- <details open>\n  <summary>題</summary>\n\n  </details>\n")!;
    const items = out.doc.firstChild!;
    expect(items.childCount).toBe(2);
    expect(items.child(0).firstChild!.childCount).toBe(2);
  });

  it("一番外のトグルでは何もしない（いつもの出方に任せる）", () => {
    expect(outAt("<details open>\n<summary>題</summary>\n\n</details>\n")).toBeNull();
  });

  it("トグルの項目の次の項目で Tab を押すと、前のトグルの中へ入る", () => {
    const src = "- <details>\n  <summary>題</summary>\n\n  中身\n\n  </details>\n- 新しい\n";
    const loaded = fromMarkdown(src);
    let at = -1;
    loaded.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text === "新しい") at = pos + 1;
      return true;
    });
    let state = EditorState.create({ doc: loaded.doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    const tr = itemIntoToggleTr(state);
    expect(tr).not.toBeNull();
    expect(tr!.doc.firstChild!.childCount).toBe(1);
  });
});

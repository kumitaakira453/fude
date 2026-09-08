import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import {
  blockKindOf,
  clearLink,
  clearMarks,
  inCell,
  linkAt,
  markedWith,
  setLink,
  toggleInline,
} from "./marks";
import { editorPlugins } from "./plugins";
import { schema } from "./schema";
import { toMarkdown } from "./toMarkdown";

// 装飾の付け外しと、いま何が付いているかの問い合わせ。帯のボタンと打鍵が
// 同じものを呼ぶので、ここが両方の振る舞いになる。

function opened(body: string) {
  const loaded = fromMarkdown(body);
  const state = EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });
  return { loaded, state };
}

function posOf(doc: EditorState["doc"], index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += doc.child(i).nodeSize;
  return at;
}

// index 番目のブロックの、表示文字 from..to を選ぶ。
function select(state: EditorState, index: number, from: number, to: number) {
  const at = posOf(state.doc, index) + 1;
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, at + from, at + to)),
  );
}

function run(
  state: EditorState,
  cmd: (s: EditorState, d: (tr: ReturnType<EditorState["tr"]["setMeta"]>) => void) => boolean,
): EditorState {
  let next = state;
  cmd(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

describe("toggleInline", () => {
  it("選んだところに付け、もう一度で外す", () => {
    const { loaded, state } = opened("はじめの段落。\n");
    const picked = select(state, 0, 0, 3);
    const on = run(picked, toggleInline(schema.marks.strong));
    expect(toMarkdown(on.doc, loaded)).toBe("**はじめ**の段落。\n");
    const off = run(on, toggleInline(schema.marks.strong));
    expect(toMarkdown(off.doc, loaded)).toBe("はじめの段落。\n");
  });

  it("一部にしか付いていない範囲は、外さずに全部へ付ける", () => {
    const { loaded, state } = opened("**ふとい**ほそい\n");
    // 「ふとい」＋「ほそ」をまとめて選ぶ。
    const picked = select(state, 0, 0, 5);
    const on = run(picked, toggleInline(schema.marks.strong));
    expect(toMarkdown(on.doc, loaded)).toBe("**ふといほそ**い\n");
  });

  it("範囲を選んでいなくても、居るひと続きの装飾を外せる", () => {
    const { loaded, state } = opened("**ふとい**あと\n");
    // 「と」の後ろにカーソルを置く（囲みの中）。
    const at = posOf(state.doc, 0) + 1;
    const caret = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, at + 2)),
    );
    const off = run(caret, toggleInline(schema.marks.strong));
    expect(toMarkdown(off.doc, loaded)).toBe("ふといあと\n");
  });
});

describe("markedWith", () => {
  it("丸ごと付いているときだけ付いていると見る", () => {
    const { state } = opened("**ふとい**ほそい\n");
    const all = select(state, 0, 0, 3);
    expect(markedWith(all, schema.marks.strong)).toBe(true);
    // 半分だけ付いている範囲は、押すと「全部に付く」ので押し込まない。
    const half = select(state, 0, 0, 5);
    expect(markedWith(half, schema.marks.strong)).toBe(false);
    const none = select(state, 0, 3, 6);
    expect(markedWith(none, schema.marks.strong)).toBe(false);
  });

  it("カーソルだけのときは、そこで継ぐ装飾を見る", () => {
    const { state } = opened("**ふとい**ほそい\n");
    const at = posOf(state.doc, 0) + 1;
    const inside = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, at + 2)),
    );
    expect(markedWith(inside, schema.marks.strong)).toBe(true);
  });
});

describe("リンク", () => {
  it("選んだところに張り、外せる", () => {
    const { loaded, state } = opened("ここを見る\n");
    const picked = select(state, 0, 0, 2);
    const on = run(picked, setLink("https://example.com"));
    expect(toMarkdown(on.doc, loaded)).toBe("[ここ](https://example.com)を見る\n");
    expect(linkAt(on)).toBe("https://example.com");
    const off = run(on, clearLink);
    expect(toMarkdown(off.doc, loaded)).toBe("ここを見る\n");
    expect(linkAt(off)).toBe(null);
  });

  it("張る先の文字が無ければ張らない", () => {
    const { state } = opened("ここを見る\n");
    expect(setLink("https://example.com")(state, undefined)).toBe(false);
  });

  it("既にリンクなら行き先を返す", () => {
    const { state } = opened("[題](https://example.com)のあと\n");
    expect(linkAt(select(state, 0, 0, 1))).toBe("https://example.com");
    expect(linkAt(select(state, 0, 2, 4))).toBe(null);
  });
});

describe("下線", () => {
  it("選んだところに付け、生の <u> で書き出す", () => {
    const { loaded, state } = opened("ここを引く\n");
    const picked = select(state, 0, 0, 2);
    const on = run(picked, toggleInline(schema.marks.underline));
    expect(toMarkdown(on.doc, loaded)).toBe("<u>ここ</u>を引く\n");
  });

  it("原文の <u> は印として読み、押すと外れる", () => {
    const { loaded, state } = opened("<u>ここ</u>を引く\n");
    expect(markedWith(select(state, 0, 0, 2), schema.marks.underline)).toBe(true);
    const off = run(select(state, 0, 0, 2), toggleInline(schema.marks.underline));
    expect(toMarkdown(off.doc, loaded)).toBe("ここを引く\n");
  });

  it("強調と重なっても原文の書き方（下線が外）で戻る", () => {
    const { loaded, state } = opened("<u>**ふとい**</u>\n");
    const picked = select(state, 0, 0, 3);
    expect(markedWith(picked, schema.marks.underline)).toBe(true);
    expect(markedWith(picked, schema.marks.strong)).toBe(true);
    // 触っていないので原文がそのまま返る。
    expect(toMarkdown(state.doc, loaded)).toBe("<u>**ふとい**</u>\n");
    const off = run(picked, toggleInline(schema.marks.strong));
    expect(toMarkdown(off.doc, loaded)).toBe("<u>ふとい</u>\n");
  });

  it("装飾の無い字が続く対は畳まない（原文との対応が崩れるため）", () => {
    const { loaded, state } = opened("<u>あ</u><u>い</u>\n");
    expect(markedWith(select(state, 0, 0, 1), schema.marks.underline)).toBe(false);
    expect(toMarkdown(state.doc, loaded)).toBe("<u>あ</u><u>い</u>\n");
  });
});

describe("clearMarks", () => {
  it("選んだところの装飾を全部落とす", () => {
    const { loaded, state } = opened("**ふとい**と*ななめ*と`コード`\n");
    const all = select(state, 0, 0, 11);
    const bare = run(all, clearMarks);
    expect(toMarkdown(bare.doc, loaded)).toBe("ふといとななめとコード\n");
  });

  it("リンクも下線も落とす", () => {
    const { loaded, state } = opened("[題](https://example.com)と<u>下線</u>\n");
    const bare = run(select(state, 0, 0, 4), clearMarks);
    expect(toMarkdown(bare.doc, loaded)).toBe("題と下線\n");
  });

  it("何も付いていなければ動かない", () => {
    const { state } = opened("素の段落\n");
    expect(clearMarks(select(state, 0, 0, 4), undefined)).toBe(false);
  });
});

describe("inCell", () => {
  it("表のセルの中だけ真", () => {
    const table = opened("| a  | b  |\n| -- | -- |\n| 1  | 2  |\n");
    const at = table.state.apply(
      table.state.tr.setSelection(TextSelection.near(table.state.doc.resolve(1))),
    );
    expect(inCell(at)).toBe(true);
    const plain = opened("段落。\n");
    expect(inCell(plain.state)).toBe(false);
  });
});

describe("blockKindOf", () => {
  const kinds: [string, string][] = [
    ["段落。\n", "text"],
    ["## 見出し\n", "h2"],
    ["#### 見出し\n", "h4"],
    ["- ひとつ\n", "bullet"],
    ["1. ひとつ\n", "ordered"],
    ["- [ ] やること\n", "todo"],
    ["| a  | b  |\n| -- | -- |\n| 1  | 2  |\n", "table"],
    ["> 引用。\n", "quote"],
    ["```ts\nconst a = 1;\n```\n", "code"],
  ];
  for (const [body, id] of kinds) {
    it(`${JSON.stringify(body)} は ${id}`, () => {
      const { state } = opened(body);
      const at = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1))),
      );
      expect(blockKindOf(at)?.id).toBe(id);
    });
  }
});

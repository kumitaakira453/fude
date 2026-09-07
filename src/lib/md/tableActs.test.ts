import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { tableActTr, tableMoveTr, type TableAct, type TablePart } from "./tableActs";
import { toMarkdown } from "./toMarkdown";

// 表の行・列の操作。見るのは書き戻した原文で、桁幅と揃えが列に付いて回るかが肝。
//
// 桁幅の控えは「その列のセルの字数が全ての行で揃っている」ときだけ取れる
// （`fromMarkdown` の `tableStyle`）。全角の字は見た目の幅と字数が合わないので、
// 桁幅を見る試験は半角で組む。

const SRC = `# Title

| name   | n  | note   |
| :----- | -: | ------ |
| aa     |  1 | one    |
| bb     |  2 | two    |

end
`;

function opened(body: string) {
  const loaded = fromMarkdown(body);
  const state = EditorState.create({
    doc: loaded.doc,
    plugins: editorPlugins({ onSave: () => {} }),
  });
  let pos = -1;
  loaded.doc.forEach((node, at) => {
    if (node.type.name === "table") pos = at;
  });
  expect(pos).toBeGreaterThanOrEqual(0);
  return { loaded, state, pos };
}

function act(body: string, kind: TablePart, at: number, a: TableAct) {
  const { loaded, state, pos } = opened(body);
  const tr = tableActTr(state, pos, kind, at, a);
  if (!tr) return null;
  const next = state.apply(tr);
  return { md: toMarkdown(next.doc, loaded), state: next, pos, tr };
}

function move(body: string, kind: TablePart, from: number, to: number) {
  const { loaded, state, pos } = opened(body);
  const tr = tableMoveTr(state, pos, kind, from, to);
  if (!tr) return null;
  return { md: toMarkdown(state.apply(tr).doc, loaded) };
}

// 表の部分だけを取り出す。前後のブロックは比べる邪魔になる。
const tableOf = (md: string) =>
  md.split("\n").filter((line) => line.startsWith("|")).join("\n");

describe("行の操作", () => {
  it("下に挿入すると、桁幅と区切り行はそのまま", () => {
    const got = act(SRC, "row", 2, "insertAfter");
    expect(tableOf(got!.md)).toBe(
      [
        "| name   | n  | note   |",
        "| :----- | -: | ------ |",
        "| aa     | 1  | one    |",
        "| bb     | 2  | two    |",
        "|        |    |        |",
      ].join("\n"),
    );
  });

  it("複製は下に置く", () => {
    const got = act(SRC, "row", 2, "duplicate");
    expect(tableOf(got!.md).split("\n").slice(2)).toEqual([
      "| aa     | 1  | one    |",
      "| bb     | 2  | two    |",
      "| bb     | 2  | two    |",
    ]);
  });

  it("クリアは升目を残して中身だけ消す", () => {
    const got = act(SRC, "row", 2, "clear");
    expect(tableOf(got!.md).split("\n").slice(2)).toEqual([
      "| aa     | 1  | one    |",
      "|        |    |        |",
    ]);
  });

  it("削除すると行が減る", () => {
    const got = act(SRC, "row", 2, "delete");
    expect(tableOf(got!.md).split("\n").slice(2)).toEqual([
      "| aa     | 1  | one    |",
    ]);
  });

  it("見出しは消せない・複製できない・クリアできない", () => {
    for (const a of ["delete", "duplicate", "clear", "insertBefore"] as TableAct[]) {
      expect(act(SRC, "row", 0, a)).toBeNull();
    }
  });

  it("見出しだけの表にも本体の 1 行目を足せる", () => {
    const got = act("| a | b |\n| - | - |\n", "row", 0, "insertAfter");
    expect(tableOf(got!.md)).toBe("| a | b |\n| - | - |\n|   |   |");
  });

  it("無い行は触らない", () => {
    expect(act(SRC, "row", 9, "delete")).toBeNull();
  });
});

describe("列の操作", () => {
  it("左に挿入すると、揃えは列に付いて回り、区切り行は桁幅どおりに引き直す", () => {
    const got = act(SRC, "col", 1, "insertBefore");
    expect(tableOf(got!.md)).toBe(
      [
        "| name   |     | n  | note   |",
        "| :----- | --- | -: | ------ |",
        "| aa     |     | 1  | one    |",
        "| bb     |     | 2  | two    |",
      ].join("\n"),
    );
  });

  it("削除しても残った列の桁幅と揃えは原文のまま", () => {
    const got = act(SRC, "col", 1, "delete");
    expect(tableOf(got!.md)).toBe(
      [
        "| name   | note   |",
        "| :----- | ------ |",
        "| aa     | one    |",
        "| bb     | two    |",
      ].join("\n"),
    );
  });

  it("先頭の列を削除しても、残りの揃えがずれない", () => {
    const got = act(SRC, "col", 0, "delete");
    expect(tableOf(got!.md).split("\n")[1]).toBe("| -: | ------ |");
  });

  it("複製は右隣に置き、桁幅と揃えも写す", () => {
    const got = act(SRC, "col", 1, "duplicate");
    expect(tableOf(got!.md)).toBe(
      [
        "| name   | n  | n  | note   |",
        "| :----- | -: | -: | ------ |",
        "| aa     | 1  | 1  | one    |",
        "| bb     | 2  | 2  | two    |",
      ].join("\n"),
    );
  });

  it("クリアでは見出しを残す。見出しは列の名前", () => {
    const got = act(SRC, "col", 1, "clear");
    expect(tableOf(got!.md)).toBe(
      [
        "| name   | n  | note   |",
        "| :----- | -: | ------ |",
        "| aa     |    | one    |",
        "| bb     |    | two    |",
      ].join("\n"),
    );
  });

  it("最後の 1 列は消さない。表でなくなる", () => {
    expect(act("| a |\n| - |\n| b |\n", "col", 0, "delete")).toBeNull();
  });

  it("挿した列でも 1 行目は見出しの印を持つ", () => {
    const got = act(SRC, "col", 1, "insertBefore");
    const table = got!.state.doc.nodeAt(got!.pos)!;
    table.child(0).forEach((cell) => expect(cell.attrs.header).toBe(true));
    table.child(1).forEach((cell) => expect(cell.attrs.header).toBe(false));
  });

  it("挿した升目にカーソルが入る", () => {
    const got = act(SRC, "col", 1, "insertBefore");
    const $at = got!.state.selection.$head;
    // セル → 行 → 表 の 3 つ上が表。挿した列（1 列目）に居る。
    expect($at.node(-1).type.name).toBe("tableRow");
    expect($at.index(-1)).toBe(1);
  });
});

describe("入れ替え", () => {
  it("行を末尾へ運ぶ", () => {
    const got = move(SRC, "row", 1, 3);
    // 升目の数が変わらない操作では、原文の詰め方がそのまま残る
    // （`toMarkdown` が変わったセルだけを原文へ差し込む）。
    expect(tableOf(got!.md).split("\n").slice(2)).toEqual([
      "| bb     |  2 | two    |",
      "| aa     |  1 | one    |",
    ]);
  });

  it("列を末尾へ運ぶと、揃えも一緒に動く", () => {
    const got = move(SRC, "col", 0, 3);
    expect(tableOf(got!.md)).toBe(
      [
        "| n  | note   | name   |",
        "| -: | ------ | :----- |",
        "| 1  | one    | aa     |",
        "| 2  | two    | bb     |",
      ].join("\n"),
    );
  });

  it("列を先頭へ運ぶ", () => {
    const got = move(SRC, "col", 2, 0);
    expect(tableOf(got!.md).split("\n")[1]).toBe("| ------ | :----- | -: |");
  });

  it("同じ場所への運びは何もしない", () => {
    expect(move(SRC, "row", 1, 1)).toBeNull();
    expect(move(SRC, "row", 1, 2)).toBeNull();
    expect(move(SRC, "col", 1, 1)).toBeNull();
    expect(move(SRC, "col", 1, 2)).toBeNull();
  });

  it("見出しは動かさず、見出しの上へも運ばせない", () => {
    expect(move(SRC, "row", 0, 2)).toBeNull();
    expect(move(SRC, "row", 2, 0)).toBeNull();
  });

  it("表の外を指したら何もしない", () => {
    const { state } = opened(SRC);
    expect(tableMoveTr(state, 0, "row", 1, 3)).toBeNull();
    expect(tableActTr(state, 0, "row", 1, "delete")).toBeNull();
  });
});

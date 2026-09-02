import { describe, expect, it } from "vitest";
import {
  cutBlock,
  insertAfter,
  insertBefore,
  moveBlock,
  moveTableRow,
  replaceBlock,
  resplitBlocks,
  splitBlocks,
} from "./blocks";

// 局所 parse は全文 parse と同じ結果でなければならない。速さのために
// 分かれ方が変わると、指摘の位置やブロック編集が別の場所を指す。
// ここでは「実際の操作を全ブロックに掛けて、全文 parse と突き合わせる」形で
// 確かめる。落ちる形（境界が危ない形）はフォールバックで一致するはず。

const DOC = [
  "# 見出し",
  "",
  "段落のひとつ。**太字**を含む。",
  "",
  "## 表",
  "",
  "| 名前 | 扱い |",
  "| --- | --- |",
  "| あ | 1 |",
  "| い | 2 |",
  "| う | 3 |",
  "",
  "- 箇条書き 1",
  "",
  "- 箇条書き 2（空行を挟んでも同じリスト）",
  "",
  "```ts",
  "const a = 1;",
  "",
  "const b = 2;",
  "```",
  "",
  '<callout icon="ℹ️" color="gray_bg">',
  "中の説明。`SoftwareBillingTable` を指す。",
  "</callout>",
  "",
  "> 引用のひとつ",
  "",
  "> 引用のふたつ",
  "",
  "1. 番号付き 1",
  "2. 番号付き 2",
  "",
  "段落の直後に箇条書きが続く形",
  "- 空行を挟まない項目",
  "",
  "    字下げのコードブロック",
  "",
  "    続きの行",
  "",
  "---",
  "",
  "Setext の見出し",
  "===============",
  "",
  "最後の段落。",
  "",
].join("\n");

// 空行を挟んでも 1 つに繋がる形を集めた本文。間の段落を消すと、上下の
// 箇条書きが 1 つのリストになる。字下げの塊も直前のリストに吸われる。
const LIST_DOC = [
  "- あ",
  "- い",
  "",
  "区切りの段落",
  "",
  "- う",
  "- え",
  "",
  "    字下げの続き",
  "",
  "1. 番号付き",
  "",
  "境目の段落",
  "",
  "1. もうひとつ",
  "",
].join("\n");

const truth = (body: string) => splitBlocks(body);
const local = (oldBody: string, newBody: string) =>
  resplitBlocks(oldBody, splitBlocks(oldBody), newBody);

const agree = (oldBody: string, newBody: string) => {
  expect(local(oldBody, newBody)).toEqual(truth(newBody));
};

describe("resplitBlocks", () => {
  it("同じ本文ならそのまま返す", () => {
    const blocks = splitBlocks(DOC);
    expect(resplitBlocks(DOC, blocks, DOC)).toBe(blocks);
  });

  it("空の割り方からは全文 parse する", () => {
    expect(resplitBlocks("", [], DOC)).toEqual(truth(DOC));
  });

  it("どのブロックを消しても全文 parse と一致する", () => {
    const blocks = splitBlocks(DOC);
    expect(blocks.length).toBeGreaterThan(10);
    for (const b of blocks) agree(DOC, cutBlock(DOC, b));
  });

  it("どのブロックの前後に差し込んでも一致する", () => {
    for (const b of splitBlocks(DOC)) {
      agree(DOC, insertAfter(DOC, b, "差し込んだ段落。"));
      agree(DOC, insertBefore(DOC, b, "## 差し込んだ見出し"));
    }
  });

  it("どのブロックを動かしても一致する", () => {
    const blocks = splitBlocks(DOC);
    for (let from = 0; from < blocks.length; from++) {
      for (const to of [0, 3, blocks.length]) {
        agree(DOC, moveBlock(DOC, blocks, from, to));
      }
    }
  });

  it("ブロックの中身を書き換えても一致する", () => {
    for (const b of splitBlocks(DOC)) {
      agree(DOC, replaceBlock(DOC, b, "書き換えた段落。"));
      agree(DOC, replaceBlock(DOC, b, `${b.src}\n追記した行`));
    }
  });

  it("表の行を入れ替えても一致する", () => {
    const table = splitBlocks(DOC).find((b) => b.type === "table");
    expect(table).toBeTruthy();
    agree(DOC, replaceBlock(DOC, table!, moveTableRow(table!.src, 2, 4)));
  });

  it("間の段落を消して箇条書きが 1 つに繋がる形でも一致する", () => {
    const blocks = splitBlocks(LIST_DOC);
    for (const b of blocks) agree(LIST_DOC, cutBlock(LIST_DOC, b));
    for (const b of blocks) {
      agree(LIST_DOC, insertAfter(LIST_DOC, b, "差し込んだ段落。"));
      agree(LIST_DOC, replaceBlock(LIST_DOC, b, "書き換えた段落。"));
    }
    for (let from = 0; from < blocks.length; from++) {
      for (const to of [0, 2, blocks.length]) {
        agree(LIST_DOC, moveBlock(LIST_DOC, blocks, from, to));
      }
    }
  });

  it("空行を潰して 2 つのブロックが繋がる形でも一致する", () => {
    const merged = DOC.replace(
      "段落のひとつ。**太字**を含む。\n",
      "段落のひとつ。**太字**を含む。",
    );
    agree(DOC, merged);
  });

  it("閉じていないフェンスができても一致する", () => {
    const broken = DOC.replace("```ts\nconst a = 1;", "```ts");
    agree(DOC, broken);
  });

  it("先頭・末尾を書き換えても一致する", () => {
    agree(DOC, DOC.replace("# 見出し", "# 別の見出し"));
    agree(DOC, `${DOC}\n足した段落。\n`);
    agree(DOC, DOC.replace("最後の段落。\n", ""));
  });

  it("続けて書き換えても一致する（割り方を土台に使い回す）", () => {
    let body = DOC;
    let blocks = splitBlocks(body);
    for (let i = 0; i < 6; i++) {
      const next = cutBlock(body, blocks[1]);
      blocks = resplitBlocks(body, blocks, next);
      body = next;
      expect(blocks).toEqual(truth(body));
    }
  });
});

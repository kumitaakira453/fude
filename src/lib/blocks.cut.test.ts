import { describe, expect, it } from "vitest";
import { cutSelection, splitBlocks } from "./blocks";
import { buildProjection } from "./projection";

// 画面で選択した箇所を消す。選択は「画面に出ている文字」で来るので、
// ソースのどこを切るかは対応表から出す。

// 画面に出ている文字での位置。選択を作るときの hint に使う。
const plainAt = (src: string, text: string) =>
  buildProjection(src).plain.indexOf(text);

const cut = (
  body: string,
  at: number,
  text: string,
  extra: { cellStart?: number; itemAnchor?: number } = {},
) => {
  const block = splitBlocks(body)[at];
  return cutSelection(body, block, {
    start: Math.max(0, plainAt(block.src, text)),
    text,
    ...extra,
  });
};

describe("cutSelection", () => {
  it("段落の一部を消す", () => {
    const body = "段落のひとつ。ここは残す。";
    expect(cut(body, 0, "ここは残す。")).toEqual({
      body: "段落のひとつ。",
      shift: false,
    });
  });

  it("段落を丸ごと選んだらブロックごと消える", () => {
    const body = "前の段落。\n\n消したい段落。\n\n後の段落。";
    expect(cut(body, 1, "消したい段落。")).toEqual({
      body: "前の段落。\n\n後の段落。",
      shift: true,
    });
  });

  it("見出しの文字を全部消したら `## ` を残さない", () => {
    const body = "# 表題\n\n## 節\n\n本文。";
    expect(cut(body, 1, "節")).toEqual({
      body: "# 表題\n\n本文。",
      shift: true,
    });
  });

  it("強調の中身を丸ごと消したら記号ごと消える", () => {
    const body = "これは**重要**な点。";
    expect(cut(body, 0, "重要")?.body).toBe("これはな点。");
  });

  it("強調の一部を消したら記号は残る", () => {
    const body = "これは**とても重要**な点。";
    expect(cut(body, 0, "とても")?.body).toBe("これは**重要**な点。");
  });

  it("リンクの文字を丸ごと消したら宛先ごと消える", () => {
    const body = "詳しくは[案内](https://example.com/a)を見る。";
    expect(cut(body, 0, "案内")?.body).toBe("詳しくはを見る。");
  });

  it("強調の中のリンクも丸ごと消える", () => {
    const body = "これは**[案内](./a.md)**です。";
    expect(cut(body, 0, "案内")?.body).toBe("これはです。");
  });

  it("同じ文字が並んでいても選んだ方を消す", () => {
    const body = "りんご と りんご";
    const block = splitBlocks(body)[0];
    const second = buildProjection(block.src).plain.lastIndexOf("りんご");
    expect(
      cutSelection(body, block, { start: second, text: "りんご" })?.body,
    ).toBe("りんご と");
  });

  it("箇条書きの項目の一部を消す", () => {
    const body = "- あ の項目\n- い の項目";
    const block = splitBlocks(body)[0];
    const anchor = block.src.indexOf("あ");
    expect(
      cutSelection(body, block, { start: 0, text: "の項目", itemAnchor: anchor })
        ?.body,
    ).toBe("- あ\n- い の項目");
  });

  it("項目の文字を全部消したら項目ごと消える", () => {
    const body = "- あ\n- い\n- う";
    const block = splitBlocks(body)[0];
    const anchor = block.src.indexOf("い");
    expect(
      cutSelection(body, block, { start: 0, text: "い", itemAnchor: anchor }),
    ).toEqual({ body: "- あ\n- う", shift: false });
  });

  it("最後に残った項目を消したらリストごと消える", () => {
    const body = "段落。\n\n- ただ 1 つの項目";
    const block = splitBlocks(body)[1];
    const anchor = block.src.indexOf("た");
    expect(
      cutSelection(body, block, {
        start: 0,
        text: "ただ 1 つの項目",
        itemAnchor: anchor,
      }),
    ).toEqual({ body: "段落。", shift: true });
  });

  it("表はセルの中身だけ消し、区切りと列は残す", () => {
    const body = "| 名前 | 扱い |\n| --- | --- |\n| あ | 消す文字 |";
    const block = splitBlocks(body)[0];
    const cellStart = block.src.lastIndexOf("|", block.src.indexOf("消す文字"));
    expect(
      cutSelection(body, block, {
        start: 0,
        text: "消す文字",
        cellStart,
      }),
    ).toEqual({
      body: "| 名前 | 扱い |\n| --- | --- |\n| あ |  |",
      shift: false,
    });
  });

  it("表でセルの目印が無い選択は消さない", () => {
    const body = "| 名前 | 扱い |\n| --- | --- |\n| あ | い |";
    expect(cut(body, 0, "あ")).toBeNull();
  });

  it("表でセルをまたぐ選択は消さない", () => {
    const body = "| 名前 | 扱い |\n| --- | --- |\n| あ | い |";
    const block = splitBlocks(body)[0];
    const cellStart = block.src.lastIndexOf("|", block.src.indexOf("あ"));
    expect(
      cutSelection(body, block, { start: 0, text: "あい", cellStart }),
    ).toBeNull();
  });

  it("コードブロックの中身を全部消したらブロックごと消える", () => {
    const body = "説明。\n\n```ts\nconst a = 1;\n```";
    expect(cut(body, 1, "const a = 1;")).toEqual({
      body: "説明。",
      shift: true,
    });
  });

  it("コールアウトの中の文を消す", () => {
    const body =
      '<callout icon="ℹ️" color="gray_bg">\n中の説明。ここは消す。\n</callout>';
    const block = splitBlocks(body)[0];
    expect(
      cutSelection(body, block, { start: 0, text: "ここは消す。" })?.body,
    ).toBe('<callout icon="ℹ️" color="gray_bg">\n中の説明。\n</callout>');
  });

  it("コールアウトの中身を全部消したら器ごと消える", () => {
    const body = '段落。\n\n<callout icon="ℹ️">\n中の説明。\n</callout>';
    const block = splitBlocks(body)[1];
    expect(
      cutSelection(body, block, { start: 0, text: "中の説明。" }),
    ).toEqual({ body: "段落。", shift: true });
  });

  it("図は触らない", () => {
    const body = "```mermaid\ngraph TD;\nA-->B;\n```";
    expect(cut(body, 0, "graph TD;")).toBeNull();
  });

  it("見つからない文字列では何も消さない", () => {
    const body = "段落のひとつ。";
    expect(cut(body, 0, "無い文字")).toBeNull();
  });
});


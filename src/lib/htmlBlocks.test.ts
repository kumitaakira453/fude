import { describe, expect, it } from "vitest";
import { openHtmlContainers, setCalloutIcon } from "./htmlBlocks";

describe("openHtmlContainers", () => {
  it("callout の中身の前後に空行を入れ、装飾の付く形に組み替える", () => {
    const src = [
      '<callout icon="ℹ️" color="gray_bg">',
      "このリリースでは `X` を削除しない。",
      "</callout>",
    ].join("\n");
    expect(openHtmlContainers(src)).toBe(
      [
        '<div class="mg-callout notion" data-color="gray_bg"><span class="mg-callout-ico" data-mg-callout-ico="1">ℹ️</span><div class="mg-callout-body">',
        "",
        "このリリースでは `X` を削除しない。",
        "",
        "</div></div>",
      ].join("\n"),
    );
  });

  it("色の指定は Notion の名前をそのまま渡す", () => {
    const src = ['<callout color="blue_bg">', "本文", "</callout>"].join("\n");
    expect(openHtmlContainers(src)).toContain('data-color="blue_bg"');
  });

  it("色の名前として読めない値は渡さない", () => {
    const src = ['<callout color="\" onx=1">', "本文", "</callout>"].join("\n");
    expect(openHtmlContainers(src)).not.toContain("data-color");
  });

  it("アイコンが無くても組み替える", () => {
    const src = ["<callout>", "本文", "</callout>"].join("\n");
    expect(openHtmlContainers(src)).toContain('<span class="mg-callout-ico" data-mg-callout-ico="1">');
    expect(openHtmlContainers(src).split("\n")[1]).toBe("");
  });

  it("複数行の中身をそのまま保つ", () => {
    const src = [
      "<callout>",
      "- 一つ目",
      "- 二つ目",
      "</callout>",
    ].join("\n");
    const got = openHtmlContainers(src).split("\n");
    expect(got.slice(2, 4)).toEqual(["- 一つ目", "- 二つ目"]);
  });

  it("アイコンに記号を書かれても文字として埋める", () => {
    const src = ['<callout icon="<b & i">', "本文", "</callout>"].join("\n");
    expect(openHtmlContainers(src)).toContain(
      '<span class="mg-callout-ico" data-mg-callout-ico="1">&lt;b &amp; i</span>',
    );
  });

  it("callout が 2 つ並んでも両方組み替える", () => {
    const src = [
      "<callout>",
      "一つ目",
      "</callout>",
      "",
      "<callout>",
      "二つ目",
      "</callout>",
    ].join("\n");
    const got = openHtmlContainers(src);
    expect(got.match(/mg-callout-body/g)?.length).toBe(2);
  });

  it("details は summary を残したまま本文だけ空行で挟む", () => {
    const src = [
      "<details>",
      "<summary>詳細</summary>",
      "`code` を含む本文",
      "</details>",
    ].join("\n");
    expect(openHtmlContainers(src)).toBe(
      [
        "<details>",
        "<summary>詳細</summary>",
        "",
        "`code` を含む本文",
        "",
        "</details>",
      ].join("\n"),
    );
  });

  it("summary が無い details でも本文を挟む", () => {
    const src = ["<details>", "本文", "</details>"].join("\n");
    expect(openHtmlContainers(src)).toBe(
      ["<details>", "", "本文", "", "</details>"].join("\n"),
    );
  });

  it("対象のタグが無ければ同じ文字列を返す", () => {
    const src = "# 見出し\n\n本文に `code` がある。";
    expect(openHtmlContainers(src)).toBe(src);
  });

  it("閉じタグが無ければ触らない", () => {
    const src = ["<callout>", "閉じ忘れ"].join("\n");
    expect(openHtmlContainers(src)).toBe(src);
  });

  it("開きタグと同じ行に中身があるものは触らない", () => {
    const src = "<callout>本文</callout>";
    expect(openHtmlContainers(src)).toBe(src);
  });

  it("インラインの details 記述は触らない", () => {
    const src = "文中に <details> と書いただけ。";
    expect(openHtmlContainers(src)).toBe(src);
  });
});

describe("setCalloutIcon", () => {
  it("既にあるアイコンを差し替える（他の属性は残す）", () => {
    const src = [
      '<callout icon="ℹ️" color="gray_bg">',
      "本文",
      "</callout>",
    ].join("\n");
    expect(setCalloutIcon(src, "⚠️").split("\n")[0]).toBe(
      '<callout icon="⚠️" color="gray_bg">',
    );
  });

  it("アイコンが無ければ足す", () => {
    const src = ['<callout color="blue_bg">', "本文", "</callout>"].join("\n");
    expect(setCalloutIcon(src, "💡").split("\n")[0]).toBe(
      '<callout icon="💡" color="blue_bg">',
    );
  });

  it("属性が無い callout にも足せる", () => {
    const src = ["<callout>", "本文", "</callout>"].join("\n");
    expect(setCalloutIcon(src, "💡").split("\n")[0]).toBe(
      '<callout icon="💡">',
    );
  });

  it("空文字を渡すとアイコンを落とす", () => {
    const src = ['<callout icon="ℹ️" color="gray_bg">', "本文", "</callout>"].join(
      "\n",
    );
    expect(setCalloutIcon(src, "").split("\n")[0]).toBe(
      '<callout color="gray_bg">',
    );
  });

  it("中身と閉じタグは変えない", () => {
    const src = ['<callout icon="ℹ️">', "`code` 入りの本文", "</callout>"].join(
      "\n",
    );
    const got = setCalloutIcon(src, "🔥").split("\n");
    expect(got[1]).toBe("`code` 入りの本文");
    expect(got[2]).toBe("</callout>");
  });

  it("callout でなければ触らない", () => {
    expect(setCalloutIcon("ただの段落。", "💡")).toBe("ただの段落。");
  });
});

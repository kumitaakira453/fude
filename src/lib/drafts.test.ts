import { describe, expect, it, vi } from "vitest";
import { draftTitle, inDrafts } from "./drafts";

// 保存先の決まっていないメモ。置き場の判定と、本文から採る名前。
// ファイルを触る部分はダイアログと権限が要るので、純関数だけを見る。

vi.mock("@tauri-apps/api/path", () => ({ appDataDir: () => Promise.resolve("/tmp") }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: () => Promise.resolve(null) }));

const DIR = "/Users/me/Library/Application Support/com.mdglow.app/drafts";

describe("置き場の判定", () => {
  it("置き場の中なら下書き", () => {
    expect(inDrafts(`${DIR}/20260912-101500-000.md`, DIR)).toBe(true);
  });

  it("末尾の / があってもなくても同じ", () => {
    expect(inDrafts(`${DIR}/a.md`, `${DIR}/`)).toBe(true);
  });

  it("置き場そのものは下書きではない", () => {
    expect(inDrafts(DIR, DIR)).toBe(false);
  });

  it("名前が途中まで同じだけの別の場所を拾わない", () => {
    expect(inDrafts(`${DIR}-old/a.md`, DIR)).toBe(false);
  });

  it("置き場が分かる前は判定しない", () => {
    expect(inDrafts(`${DIR}/a.md`, null)).toBe(false);
    expect(inDrafts(null, DIR)).toBe(false);
  });
});

describe("保存するときの既定の名前", () => {
  it("最初の見出しを使う", () => {
    expect(draftTitle("# 会議のめも\n\n本文\n")).toBe("会議のめも");
    expect(draftTitle("### 小さな見出し\n")).toBe("小さな見出し");
  });

  it("見出しが無ければ最初の字のある行", () => {
    expect(draftTitle("\n\n買うもの\n- 牛乳\n")).toBe("買うもの");
  });

  it("ファイル名に使えない字は落とす", () => {
    expect(draftTitle("# 2026/09/12 の記録")).toBe("20260912 の記録");
    expect(draftTitle("# a:b*c?d")).toBe("abcd");
  });

  it("長い見出しは切り詰める", () => {
    expect(draftTitle(`# ${"あ".repeat(80)}`)).toHaveLength(40);
  });

  it("何も書いていなければ無題", () => {
    expect(draftTitle("")).toBe("無題");
    expect(draftTitle("\n \n\t\n")).toBe("無題");
  });

  it("記号だけの行は名前にしない", () => {
    expect(draftTitle("---\n\n本文がここ\n")).toBe("本文がここ");
    expect(draftTitle("## ***\n\n次の行\n")).toBe("次の行");
  });
});

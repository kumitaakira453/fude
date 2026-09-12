import { describe, expect, it, vi } from "vitest";
import { inDrafts } from "./drafts";

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

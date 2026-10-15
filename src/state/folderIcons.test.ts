// @vitest-environment jsdom
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moveFolderIcons } from "../lib/folderIcons";
import { windowScopedKey } from "../lib/windows";

// 覚えている設定を、画面に一度も出さないまま前の値を元に書き換える。
//
// 名前の変更・移動・削除は画面を介さずに書くので、まだ画面で使われていない窓
// （ファイル 1 枚だけの窓など）でも走る。そのとき前の値として空を読むと、
// 付けておいたものを空で上書きして全部消してしまう。
//
// 設定は起動したとき（定義を読み込んだとき）に保存領域から読むので、試験でも
// 保存領域に入れてから定義を読み込む。

beforeEach(() => vi.resetModules());
afterEach(() => localStorage.clear());

describe("画面に出す前の書き換え", () => {
  it("フォルダの名前を変えても、ほかのフォルダのアイコンは残る", async () => {
    localStorage.setItem(
      "mdglow:foldericons",
      JSON.stringify({ "/本/bugs": "bug_report", "/本/notes": "stylus_note" }),
    );
    const A = await import("./atoms");
    const store = createStore();
    store.set(A.folderIconsAtom, (was) => moveFolderIcons(was, "/本/notes", "/本/memo"));
    expect(JSON.parse(localStorage.getItem("mdglow:foldericons")!)).toEqual({
      "/本/bugs": "bug_report",
      "/本/memo": "stylus_note",
    });
  });

  it("木の開閉の控えに書き足しても、ほかのフォルダの控えは残る", async () => {
    const key = windowScopedKey("mdglow:expanded");
    localStorage.setItem(key, JSON.stringify({ "/本": ["/本/bugs"] }));
    const A = await import("./atoms");
    const store = createStore();
    store.set(A.expandedByFolderAtom, (prev) => ({ ...prev, "/別": ["/別/a"] }));
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      "/本": ["/本/bugs"],
      "/別": ["/別/a"],
    });
  });
});

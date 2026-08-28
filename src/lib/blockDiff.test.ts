import { describe, expect, it } from "vitest";
import { splitBlocks } from "./blocks";
import { diffBlocks, headOf, resolveInDiff, targetIndex } from "./blockDiff";

const kinds = (body: string, next: string) =>
  diffBlocks(splitBlocks(body), splitBlocks(next)).map((c) => c.kind);

describe("diffBlocks", () => {
  it("同じ内容なら全て same", () => {
    const body = "# 見出し\n\n段落A\n\n段落B";
    expect(kinds(body, body)).toEqual(["same", "same", "same"]);
  });

  it("段落の書き換えを changed として組む", () => {
    const before = "# 見出し\n\n従来のSaaSと費用構造が異なる。";
    const after = "# 見出し\n\n従来のSaaSと費用構造が根本的に異なり、従量課金である。";
    const diff = diffBlocks(splitBlocks(before), splitBlocks(after));
    expect(diff.map((c) => c.kind)).toEqual(["same", "changed"]);
    const changed = diff[1];
    expect(changed.kind).toBe("changed");
    if (changed.kind === "changed") {
      expect(changed.base.src).toContain("異なる。");
      expect(changed.head.src).toContain("根本的に");
    }
  });

  it("冒頭への挿入で以降が same のまま保たれる", () => {
    // 行単位の突き合わせだと以降が全部ずれるが、ブロック単位なら影響しない
    const before = "段落A\n\n段落B\n\n段落C";
    const after = "新しい段落\n\n段落A\n\n段落B\n\n段落C";
    expect(kinds(before, after)).toEqual(["added", "same", "same", "same"]);
  });

  it("削除を removed として出す", () => {
    expect(kinds("段落A\n\n段落B\n\n段落C", "段落A\n\n段落C")).toEqual([
      "same",
      "removed",
      "same",
    ]);
  });

  it("末尾への追加", () => {
    expect(kinds("段落A", "段落A\n\n段落B")).toEqual(["same", "added"]);
  });

  it("空から追加、全消しから削除", () => {
    expect(kinds("", "段落A")).toEqual(["added"]);
    expect(kinds("段落A", "")).toEqual(["removed"]);
    expect(kinds("", "")).toEqual([]);
  });

  it("並べ替えは追加と削除になる", () => {
    // 内容一致でしか対応付けないため、移動は片方が残り片方が動く
    const k = kinds("段落A\n\n段落B", "段落B\n\n段落A");
    expect(k).toContain("same");
    expect(k.length).toBe(3);
  });
});

describe("targetIndex", () => {
  const before = "# 背景\n\n従来のSaaSと費用構造が異なる。\n\n別の段落";
  const after = "# 背景\n\n従来のSaaSと費用構造が根本的に異なる。\n\n別の段落";
  const diff = diffBlocks(splitBlocks(before), splitBlocks(after));

  it("指摘が付いたブロックの位置を引ける", () => {
    const i = targetIndex(diff, "従来のSaaSと費用構造が異なる。");
    expect(i).toBe(1);
    const change = diff[i];
    expect(change.kind).toBe("changed");
    if (change.kind === "changed") {
      expect(change.head.src).toBe("従来のSaaSと費用構造が根本的に異なる。");
    }
  });

  it("変わっていないブロックも引ける", () => {
    expect(diff[targetIndex(diff, "別の段落")].kind).toBe("same");
  });

  it("選択した文しか無い指摘は、その文を含むブロックに寄せる", () => {
    // 取り込んだ指摘は引用がブロック本文の一部しか持たない
    expect(targetIndex(diff, "費用構造が異なる", "費用構造が異なる")).toBe(1);
    expect(targetIndex(diff, "存在しない文")).toBe(-1);
    expect(targetIndex(diff, "   ")).toBe(-1);
  });

  it("記法が落ちた選択テキストでも位置を引ける", () => {
    // 別アプリから取り込んだ指摘は「画面に出ていた文字列」を持つ。
    // 太字・インラインコード・表の区切りが落ちている。
    const src = [
      "**`member_basic_field`** の選択肢",
      "",
      "| 定数名 | 値 |",
      "| --- | --- |",
      "| `EMAIL` | email |",
    ].join("\n");
    const d = diffBlocks(splitBlocks(src), splitBlocks(src));
    expect(targetIndex(d, "", "member_basic_field の選択肢")).toBe(0);
    // 表のセル間にブラウザが差し込むタブや改行も均される
    expect(targetIndex(d, "", "定数名\t値\nEMAIL\temail")).toBe(1);
  });

  it("候補が一意に決まらない選択は特定しない", () => {
    // 短い文はどの文書にも複数現れる。無理に当てると別の箇所を指してしまう
    const src = "**あ** い\n\nまた **あ** い";
    const d = diffBlocks(splitBlocks(src), splitBlocks(src));
    expect(targetIndex(d, "", "あ")).toBe(-1);
  });

  it("一意に決まるなら短い選択でも特定する", () => {
    const d = diffBlocks(splitBlocks("はじめに\n\n背景"), splitBlocks("はじめに\n\n背景"));
    expect(targetIndex(d, "", "背景")).toBe(1);
  });

  it("削除されたブロックの位置を引ける", () => {
    const d = diffBlocks(splitBlocks("段落A\n\n消える段落"), splitBlocks("段落A"));
    expect(d[targetIndex(d, "消える段落")].kind).toBe("removed");
  });
});

describe("resolveInDiff", () => {
  // 指摘を付けた時点の本文（= 基準版として保存されるもの）
  const base = "# 背景\n\n従来のSaaSと費用構造が異なる。\n\n別の段落";

  it("対象を丸ごと書き換えても現在のブロックを指せる", () => {
    // 引用文字列が 1 文字も残らないよう完全に書き換える。
    // 現在の本文から探す方法ではここで位置を失う
    const head =
      "# 背景\n\n生成AIは従量課金であり、月末の着地が読めない点が問題になる。\n\n別の段落";
    const diff = diffBlocks(splitBlocks(base), splitBlocks(head));
    const r = resolveInDiff(diff, "従来のSaaSと費用構造が異なる。");
    expect(r.state).toBe("rewritten");
    if (r.state === "rewritten") {
      expect(r.head.src).toBe("生成AIは従量課金であり、月末の着地が読めない点が問題になる。");
      expect(r.base.src).toBe("従来のSaaSと費用構造が異なる。");
      expect(r.head.index).toBe(1);
    }
    expect(headOf(r)?.index).toBe(1);
  });

  it("前に段落が挿入されても、ずれた先のブロックを指す", () => {
    const head = "# 背景\n\n差し込まれた段落\n\n従来のSaaSと費用構造が異なる。\n\n別の段落";
    const diff = diffBlocks(splitBlocks(base), splitBlocks(head));
    const r = resolveInDiff(diff, "従来のSaaSと費用構造が異なる。");
    expect(r.state).toBe("unchanged");
    // 現在の文書では 3 番目のブロックに移っている
    expect(headOf(r)?.index).toBe(2);
  });

  it("変わっていなければ unchanged", () => {
    const diff = diffBlocks(splitBlocks(base), splitBlocks(base));
    const r = resolveInDiff(diff, "別の段落");
    expect(r.state).toBe("unchanged");
    expect(headOf(r)?.src).toBe("別の段落");
  });

  it("削除されていれば removed。印を付ける位置は無い", () => {
    const head = "# 背景\n\n別の段落";
    const diff = diffBlocks(splitBlocks(base), splitBlocks(head));
    const r = resolveInDiff(diff, "従来のSaaSと費用構造が異なる。");
    expect(r.state).toBe("removed");
    expect(headOf(r)).toBeNull();
  });

  it("基準版に対象が無ければ unknown", () => {
    const diff = diffBlocks(splitBlocks(base), splitBlocks(base));
    const r = resolveInDiff(diff, "この文書には存在しない段落");
    expect(r.state).toBe("unknown");
    expect(headOf(r)).toBeNull();
  });
});

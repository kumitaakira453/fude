import { describe, expect, it } from "vitest";
import { tableDiff, type CellSpan } from "./tableDiff";

// 印の付いたセルを「行:桁」で並べる。中身の位置まで見たいときは span を読む。
const at = (spans: CellSpan[]) => spans.map((s) => `${s.row}:${s.cell}`);
const cut = (rows: string[][], span: CellSpan) =>
  rows[span.row][span.cell].slice(span.from, span.to);

describe("表の差分", () => {
  it("同じ表には印が付かない", () => {
    const rows = [
      ["項目", "内容"],
      ["権限", "閲覧者は変更できない"],
    ];
    const diff = tableDiff(rows, rows);
    expect(diff.del).toEqual([]);
    expect(diff.ins).toEqual([]);
  });

  it("増えた行は、その行のセルだけに印が付く", () => {
    const base = [
      ["項目", "内容"],
      ["権限", "閲覧者は変更できない"],
    ];
    const head = [
      ["項目", "内容"],
      ["監査ログ", "変更を記録する"],
      ["権限", "閲覧者は変更できない"],
    ];
    const diff = tableDiff(base, head);
    expect(diff.del).toEqual([]);
    expect(at(diff.ins)).toEqual(["1:0", "1:1"]);
    expect(diff.ins.map((s) => cut(head, s))).toEqual(["監査ログ", "変更を記録する"]);
  });

  it("減った行も同じように出る", () => {
    const base = [
      ["項目", "内容"],
      ["監査ログ", "変更を記録する"],
      ["権限", "閲覧者は変更できない"],
    ];
    const head = [
      ["項目", "内容"],
      ["権限", "閲覧者は変更できない"],
    ];
    const diff = tableDiff(base, head);
    expect(at(diff.del)).toEqual(["1:0", "1:1"]);
    expect(diff.ins).toEqual([]);
  });

  it("1 セルだけ書き換わった行は、そのセルにしか印が付かない", () => {
    const base = [
      ["項目", "内容"],
      ["権限", "閲覧者は変更できない"],
    ];
    const head = [
      ["項目", "内容"],
      ["権限", "閲覧者は指定できない"],
    ];
    const diff = tableDiff(base, head);
    expect(at(diff.del)).toEqual(["1:1"]);
    expect(at(diff.ins)).toEqual(["1:1"]);
  });

  it("書き換わったセルの中では、変わった字だけが返る", () => {
    const base = [["権限", "閲覧者は変更できない"]];
    const head = [["権限", "閲覧者は指定できない"]];
    const diff = tableDiff(base, head);
    expect(diff.del.map((s) => cut(base, s))).toEqual(["変更"]);
    expect(diff.ins.map((s) => cut(head, s))).toEqual(["指定"]);
  });

  it("空のセルは印を持たない", () => {
    const base: string[][] = [["項目", "内容"]];
    const head: string[][] = [
      ["項目", "内容"],
      ["備考", ""],
    ];
    const diff = tableDiff(base, head);
    expect(at(diff.ins)).toEqual(["1:0"]);
  });

  it("桁が増えたら、増えた桁のセルに印が付く", () => {
    const base = [
      ["項目", "内容"],
      ["権限", "閲覧者は変更できない"],
    ];
    const head = [
      ["項目", "内容", "備考"],
      ["権限", "閲覧者は変更できない", "管理者は除く"],
    ];
    const diff = tableDiff(base, head);
    expect(diff.del).toEqual([]);
    expect(at(diff.ins)).toEqual(["0:2", "1:2"]);
  });

  it("見出しの行も対象になる", () => {
    const base = [
      ["項目", "内容"],
      ["権限", "閲覧者は変更できない"],
    ];
    const head = [
      ["項目", "確認内容"],
      ["権限", "閲覧者は変更できない"],
    ];
    const diff = tableDiff(base, head);
    expect(at(diff.ins)).toEqual(["0:1"]);
    expect(diff.ins.map((s) => cut(head, s))).toEqual(["確認"]);
  });

  it("行が丸ごと入れ替わっても、行の対応を取り違えない", () => {
    const base = [
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ];
    const head = [
      ["a", "1"],
      ["c", "3"],
    ];
    const diff = tableDiff(base, head);
    expect(at(diff.del)).toEqual(["1:0", "1:1"]);
    expect(diff.ins).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { childPath, countNodes, flatten, isJsonPath, openTo, withChildren } from "./jsonTree";

const doc = { name: "fude", tags: ["a", "b"], meta: { "a b": 1, ok: true, none: null } };
const shape = (rows: ReturnType<typeof flatten>) =>
  rows.map((r) => `${"  ".repeat(r.depth)}${r.key ?? "$"}:${r.kind}${r.open ? "+" : ""}${r.count ? `(${r.count})` : ""}`);

describe("道筋", () => {
  it("識別子の形の名前は . で、そうでなければ [\"…\"]、配列は [番号] でつなぐ", () => {
    expect(childPath("$", "name")).toBe("$.name");
    expect(childPath("$", "a b")).toBe('$["a b"]');
    expect(childPath("$", "x.y")).toBe('$["x.y"]');
    expect(childPath("$.tags", 1)).toBe("$.tags[1]");
  });

  it(".json だけを JSON として扱う", () => {
    expect(isJsonPath("a/b.JSON")).toBe(true);
    expect(isJsonPath("a/b.jsonl")).toBe(false);
  });
});

describe("行の並び", () => {
  it("開いた項目の中だけを並べ、閉じた項目には中身の数を持たせる", () => {
    expect(shape(flatten(doc, new Set(["$"])))).toEqual([
      "$:object+(3)",
      "  name:string",
      "  tags:array(2)",
      "  meta:object(3)",
    ]);
  });

  it("入れ子を開くと、その下に子が並ぶ", () => {
    const rows = flatten(doc, new Set(["$", '$.meta']));
    expect(shape(rows).slice(3)).toEqual([
      "  meta:object+(3)",
      "    a b:number",
      "    ok:boolean",
      "    none:null",
    ]);
    expect(rows[4].path).toBe('$.meta["a b"]');
  });

  it("深さで開く（2 段目まで）", () => {
    expect([...openTo(doc, 2)].sort()).toEqual(["$", "$.meta", "$.tags"]);
    expect([...openTo(doc, 1)]).toEqual(["$"]);
  });

  it("下の項目までまとめて集める", () => {
    const deep = { a: { b: { c: [1] } }, d: 2 };
    expect(withChildren(deep.a, "$.a")).toEqual(["$.a", "$.a.b", "$.a.b.c"]);
    expect(withChildren(2, "$.d")).toEqual([]);
  });

  it("根が値だけでも 1 行になる", () => {
    expect(shape(flatten("x", new Set(["$"])))).toEqual(["$:string"]);
  });

  it("項目の数を数える", () => {
    expect(countNodes(doc)).toBe(9);
  });
});

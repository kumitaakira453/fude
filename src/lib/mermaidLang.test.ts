import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { mermaidMode } from "./mermaidLang";

// 1 行を「文字列と種類」の並びにする。空白は種類を持たないので落とす。
function tokens(line: string): [string, string | null][] {
  const stream = new StringStream(line, 2, 2);
  const state = mermaidMode.startState();
  const out: [string, string | null][] = [];
  while (!stream.eol()) {
    stream.start = stream.pos;
    const kind = mermaidMode.token(stream, state);
    const text = line.slice(stream.start, stream.pos);
    if (text.trim() !== "") out.push([text, kind]);
  }
  return out;
}

describe("mermaid の色分け", () => {
  it("図の種類と組み立ての語を拾う", () => {
    expect(tokens("erDiagram")).toEqual([["erDiagram", "keyword"]]);
    expect(tokens("flowchart TD")).toEqual([
      ["flowchart", "keyword"],
      ["TD", "keyword"],
    ]);
    expect(tokens("SoftwareBillingTable")).toEqual([
      ["SoftwareBillingTable", null],
    ]);
  });

  it("線をひとまとまりで拾う", () => {
    expect(tokens("A ||--o{ B")).toEqual([
      ["A", null],
      ["||--o{", "operator"],
      ["B", null],
    ]);
    expect(tokens("A -->> B")).toEqual([
      ["A", null],
      ["-->>", "operator"],
      ["B", null],
    ]);
    // 前後に空白が無くても、名前が線を飲み込まない
    expect(tokens("A-->B")).toEqual([
      ["A", null],
      ["-->", "operator"],
      ["B", null],
    ]);
    // 綴りの一部の `-` は名前に残す
    expect(tokens("stateDiagram-v2")).toEqual([["stateDiagram-v2", "keyword"]]);
  });

  it("形の括弧は線として扱わない", () => {
    expect(tokens("A{判定}")).toEqual([
      ["A", null],
      ["{", null],
      ["判定", null],
      ["}", null],
    ]);
  });

  it("コロンの後ろは行末までひとまとまりにする", () => {
    expect(tokens("A->>B: 呼ぶ : 二つ目")).toEqual([
      ["A", null],
      ["->>", "operator"],
      ["B", null],
      [":", null],
      ["呼ぶ : 二つ目", "labelName"],
    ]);
  });

  it("文字列・数値・注記を拾う", () => {
    expect(tokens('X : "filters"')).toEqual([
      ["X", null],
      [":", null],
      ['"filters"', "labelName"],
    ]);
    expect(tokens("%% 覚え書き")).toEqual([["%% 覚え書き", "comment"]]);
    expect(tokens("12")).toEqual([["12", "number"]]);
  });
});

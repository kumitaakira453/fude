import { describe, expect, it } from "vitest";
import { isMermaidBlock, mermaidBody, replaceMermaidBody } from "./blocks";

describe("mermaid ブロック", () => {
  it("囲みの行を除いて中身だけを取り出す", () => {
    const src = "```mermaid\nflowchart TD\n  A --> B\n```";
    expect(isMermaidBlock(src)).toBe(true);
    expect(mermaidBody(src)).toBe("flowchart TD\n  A --> B");
  });

  it("閉じの行が無くても中身を取り出せる", () => {
    expect(mermaidBody("```mermaid\nflowchart TD")).toBe("flowchart TD");
  });

  it("中身を差し替えても囲みはそのまま残る", () => {
    const src = "````mermaid\nflowchart TD\n  A --> B\n````";
    expect(replaceMermaidBody(src, "sequenceDiagram\n  A->>B: 呼ぶ")).toBe(
      "````mermaid\nsequenceDiagram\n  A->>B: 呼ぶ\n````",
    );
  });

  it("~~~ の囲みも保つ", () => {
    const src = "~~~mermaid\nflowchart TD\n~~~";
    expect(replaceMermaidBody(src, "flowchart LR")).toBe(
      "~~~mermaid\nflowchart LR\n~~~",
    );
  });

  it("空にすると囲みだけが残る", () => {
    const src = "```mermaid\nflowchart TD\n```";
    expect(replaceMermaidBody(src, "  \n")).toBe("```mermaid\n```");
  });
});

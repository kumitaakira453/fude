import { describe, expect, it } from "vitest";
import { isMermaidBlock } from "./blocks";

describe("mermaid ブロック", () => {
  it("mermaid の囲みを図として見分ける", () => {
    expect(isMermaidBlock("```mermaid\nflowchart TD\n  A --> B\n```")).toBe(true);
    expect(isMermaidBlock("````mermaid\nflowchart TD\n````")).toBe(true);
  });

  it("ほかの言語の囲みは図にしない", () => {
    expect(isMermaidBlock("```ts\nconst a = 1\n```")).toBe(false);
  });
});

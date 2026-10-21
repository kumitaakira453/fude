import { describe, expect, it } from "vitest";
import { isDiagramBlock } from "./blocks";

describe("図のブロック", () => {
  it("mermaid の囲みを図として見分ける", () => {
    expect(isDiagramBlock("```mermaid\nflowchart TD\n  A --> B\n```")).toBe(true);
    expect(isDiagramBlock("````mermaid\nflowchart TD\n````")).toBe(true);
  });

  it("d2 の囲みも図として見分ける", () => {
    expect(isDiagramBlock("```d2\na -> b\n```")).toBe(true);
  });

  it("ほかの言語の囲みは図にしない", () => {
    expect(isDiagramBlock("```ts\nconst a = 1\n```")).toBe(false);
  });
});

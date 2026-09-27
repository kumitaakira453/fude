import katex from "katex";
import { describe, expect, it } from "vitest";
import { katexSafe } from "./katexSafe";

// KaTeX が落とす書き方だけを包み、ほかは素通しにする。

const renders = (tex: string) => {
  katex.renderToString(tex, { throwOnError: true });
  return true;
};

describe("katexSafe", () => {
  it("演算子名を波括弧なしで添字にした式を組めるようにする", () => {
    for (const tex of ["2/\\lambda_\\max", "\\eta_\\min + \\eta_\\max", "x^\\log", "a_ \\sup"]) {
      expect(() => katex.renderToString(tex, { throwOnError: true })).toThrow();
      expect(renders(katexSafe(tex))).toBe(true);
    }
    expect(katexSafe("\\lambda_\\max")).toBe("\\lambda_{\\max}");
  });

  it("記号・引数を取る命令・長い名前の途中は触らない", () => {
    for (const tex of ["\\rho_\\text{GD}", "x_\\alpha", "y_\\sqrt{2}", "z_\\maxima", "\\max_i x_i"]) {
      expect(katexSafe(tex)).toBe(tex);
    }
  });
});

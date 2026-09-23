import { describe, expect, it } from "vitest";
import { langOf, paintLines } from "./code";

const flat = (lines: ReturnType<typeof paintLines>) =>
  lines.map((pieces) => pieces.map((p) => p.text).join(""));

describe("原文を行ごとに色分けする", () => {
  it("元の字は 1 文字も落ちない", () => {
    const code = '<div class="a">\n  こんにちは\n</div>\n';
    expect(flat(paintLines(code, "xml")).join("\n")).toBe(code);
  });

  it("行の数は改行の数と揃う", () => {
    expect(paintLines("a\nb\nc", "xml")).toHaveLength(3);
    // 末尾の改行のうしろにも空の行が 1 つある（原文と同じ見え方にする）。
    expect(paintLines("a\n", "xml")).toHaveLength(2);
  });

  it("色の付くところと付かないところが混じる", () => {
    const lines = paintLines('<a href="x">y</a>', "xml");
    const cls = lines[0].map((p) => p.cls);
    expect(cls.some((c) => c !== null)).toBe(true);
    expect(cls.some((c) => c === null)).toBe(true);
  });

  it("色の範囲が行をまたいでも、行ごとに切れる", () => {
    const code = "<!--\n  覚え書き\n-->";
    const lines = paintLines(code, "xml");
    expect(flat(lines)).toEqual(["<!--", "  覚え書き", "-->"]);
    for (const line of lines) {
      for (const piece of line) expect(piece.text).not.toContain("\n");
    }
  });

  it("知らない言語でも原文はそのまま出る", () => {
    expect(flat(paintLines("なにか\n", null))).toEqual(["なにか", ""]);
  });

  it("大きすぎるものには色を付けない（原文は返す）", () => {
    const code = "<b>x</b>\n".repeat(40_000);
    const lines = paintLines(code, "xml");
    expect(lines[0].every((p) => p.cls === null)).toBe(true);
    expect(flat(lines)[0]).toBe("<b>x</b>");
  });
});

describe("名前から色付けの言語を決める", () => {
  it("拡張子をそのまま引く", () => {
    expect(langOf("a.python")).toBe("python");
    expect(langOf("/x/y/style.css")).toBe("css");
    expect(langOf("設定.json")).toBe("json");
  });

  it("hljs が持つ別名も当たる", () => {
    expect(langOf("app.ts")).toBe("ts");
    expect(langOf("app.py")).toBe("py");
    expect(langOf("compose.yml")).toBe("yml");
    expect(langOf("main.h")).toBe("h");
  });

  it("別名の無い綴りは表で補う", () => {
    expect(langOf("httpd.conf")).toBe("ini");
    expect(langOf(".env")).toBe("ini");
    expect(langOf("Gemfile")).toBe("ruby");
    expect(langOf("頁.mdx")).toBe("markdown");
  });

  it("自前で足した文法も引ける（Terraform）", () => {
    expect(langOf("main.tf")).toBe("tf");
    expect(langOf("本番.tfvars")).toBe("tfvars");
  });

  it("拡張子の無い名前は名前そのもので引く", () => {
    expect(langOf("Dockerfile")).toBe("dockerfile");
    expect(langOf("/x/Makefile")).toBe("makefile");
  });

  it("決まらなければ null", () => {
    expect(langOf("LICENSE")).toBe(null);
    expect(langOf("控え.bak")).toBe(null);
    expect(langOf("")).toBe(null);
  });
});

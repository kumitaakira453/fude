import fs from "node:fs";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { reload } from "./reload";
import { toMarkdown } from "./toMarkdown";

// 局所化は大きいファイルだけに効かせる（小さいものは全体でも数 ms）。
// 試験のために、その閾値を超える本文を組み立てる。
const FILLER = Array.from(
  { length: 400 },
  (_, i) => `## 節 ${i}\n\n${"あ".repeat(60)}\n`,
).join("\n");

const bodyOf = (head: string, tailText: string) =>
  `${head}\n\n${FILLER}\n${tailText}\n`;

// 差し替えを実際に流して、doc が狙いどおりになるか確かめる。
function apply(old: ReturnType<typeof fromMarkdown>, next: string) {
  const got = reload(old, next);
  if (!got) return null;
  const state = EditorState.create({ doc: old.doc });
  const after = state.apply(
    state.tr.replaceWith(got.from, got.to, got.content),
  ).doc;
  return { got, after };
}

describe("変わったところだけ読み直す", () => {
  it("先頭のブロックを直す", () => {
    const old = fromMarkdown(bodyOf("# 題", "おわり"));
    const next = bodyOf("# 題を直した", "おわり");
    const r = apply(old, next);
    expect(r).not.toBeNull();
    expect(toMarkdown(r!.got.doc, r!.got.loaded)).toBe(next);
    expect(r!.after.eq(r!.got.doc)).toBe(true);
    // 触れていないブロックは節点をそのまま使い回す。
    expect(r!.got.doc.child(2)).toBe(old.doc.child(2));
  });

  it("末尾のブロックを直す", () => {
    const old = fromMarkdown(bodyOf("# 題", "おわり"));
    const next = bodyOf("# 題", "おわりを直した");
    const r = apply(old, next);
    expect(r).not.toBeNull();
    expect(toMarkdown(r!.got.doc, r!.got.loaded)).toBe(next);
    expect(r!.after.eq(r!.got.doc)).toBe(true);
    expect(r!.got.doc.child(0)).toBe(old.doc.child(0));
  });

  it("真ん中のブロックを直すと、差し替えはその 1 つに収まる", () => {
    const old = fromMarkdown(bodyOf("# 題", "おわり"));
    const next = bodyOf("# 題", "おわり").replace("## 節 200", "## 節 200 を直した");
    const r = apply(old, next);
    expect(r).not.toBeNull();
    expect(toMarkdown(r!.got.doc, r!.got.loaded)).toBe(next);
    expect(r!.got.content.childCount).toBe(1);
    expect(r!.got.doc.childCount).toBe(old.doc.childCount);
  });

  it("ブロックを足す", () => {
    const old = fromMarkdown(bodyOf("# 題", "おわり"));
    const next = bodyOf("# 題", "おわり").replace(
      "## 節 200",
      "足した段落。\n\n## 節 200",
    );
    const r = apply(old, next);
    expect(r).not.toBeNull();
    expect(toMarkdown(r!.got.doc, r!.got.loaded)).toBe(next);
    expect(r!.got.doc.childCount).toBe(old.doc.childCount + 1);
  });

  it("ブロックを消す", () => {
    const body = bodyOf("# 題", "おわり");
    const old = fromMarkdown(body);
    const next = body.replace("## 節 200\n\n", "");
    const r = apply(old, next);
    expect(r).not.toBeNull();
    expect(toMarkdown(r!.got.doc, r!.got.loaded)).toBe(next);
    expect(r!.got.doc.childCount).toBe(old.doc.childCount - 1);
  });

  it("目印は使い回した分とぶつからない", () => {
    const old = fromMarkdown(bodyOf("# 題", "おわり"));
    const next = bodyOf("# 題", "おわり").replace("## 節 200", "## 直した");
    const r = apply(old, next);
    const ids = new Set<string>();
    r!.got.doc.forEach((node) => {
      const id = node.attrs.id as string;
      expect(ids.has(id)).toBe(false);
      ids.add(id);
      // 目印から原文の範囲が引けること
      expect(r!.got.loaded.ranges.get(id)).toBeDefined();
    });
  });

  it("小さい本文では局所化しない", () => {
    const old = fromMarkdown("あ\n\nい\n");
    expect(reload(old, "あ\n\nう\n")).toBeNull();
  });

  it("変わっていなければ何もしない", () => {
    const body = bodyOf("# 題", "おわり");
    const old = fromMarkdown(body);
    expect(reload(old, body)).toBeNull();
  });

  it("ブロックが繋がる形は全体の読み直しへ落とす", () => {
    const body = bodyOf("# 題", "おわり");
    const old = fromMarkdown(body);
    // 空行を消すと 2 つの段落が 1 つになる。切り方では追えない。
    const next = body.replace("## 節 200\n\n", "## 節 200\n");
    const r = reload(old, next);
    if (r) expect(toMarkdown(r.doc, r.loaded)).toBe(next);
  });
});

const REAL = "/Users/kumitaakira/demia_works/wasurenai/monorepo-docs/rearchitecture/software/CHECKLIST.archived.md";

describe.skipIf(!fs.existsSync(REAL))("実データ", () => {
  it("局所化した結果が全体の読み直しと同じ doc になる", { timeout: 60_000 }, () => {
    const body = fs.readFileSync(REAL, "utf8");
    const old = fromMarkdown(body);
    // 真ん中あたりの行を 1 つ書き換える。
    const lines = body.split("\n");
    const at = lines.findIndex((line, i) => i > lines.length / 2 && line.trim().length > 10);
    lines[at] = `${lines[at]} 直した`;
    const next = lines.join("\n");

    const r = apply(old, next);
    expect(r).not.toBeNull();
    expect(toMarkdown(r!.got.doc, r!.got.loaded)).toBe(next);
    expect(r!.after.eq(r!.got.doc)).toBe(true);
    // 全体を読み直したものと同じ形か。目印（id）は付け替えるので、
    // 種類と中身で突き合わせる。
    const shape = (doc: typeof old.doc) => {
      const out: string[] = [];
      doc.forEach((node) => out.push(`${node.type.name}:${node.textContent}`));
      return out;
    };
    expect(shape(r!.got.doc)).toEqual(shape(fromMarkdown(next).doc));
  });
});

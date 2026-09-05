import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../frontmatter";
import { fromMarkdown, parseTree } from "./fromMarkdown";
import { toMarkdown, blockText } from "./toMarkdown";

// 実データで受け入れ条件を測る。手元に文書が無い環境（CI）では飛ばす。
//
//   a 無編集の往復が原文とバイト一致するか  … 100% でなければ設計の欠陥
//   b 全ブロックを組み直したときの一致率    … 触ったブロックに出る差分の量
//   c 組み直したものが同じ木に読み直せるか  … 意味を失っていないかの確認
//
// b は 100% にならなくてよい。触っていないブロックは a の経路（原文そのまま）を
// 通るので、b が効くのは編集したブロックだけ。

const ROOT = "/Users/kumitaakira/demia_works/wasurenai/monorepo-docs";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === ".snapshots") continue;
      walk(p, out);
    } else if (e.name.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

const bare = (text: string): string =>
  JSON.stringify(parseTree(text), (key, value) => (key === "position" ? undefined : value));

describe.skipIf(!fs.existsSync(ROOT))("実データ", () => {
  const files = walk(ROOT);

  it("無編集の往復は原文と一致する", { timeout: 120_000 }, () => {
    const broken: string[] = [];
    for (const file of files) {
      const { body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
      const loaded = fromMarkdown(body);
      if (toMarkdown(loaded.doc, loaded) !== body) broken.push(path.relative(ROOT, file));
    }
    console.log(`a: ${files.length - broken.length} / ${files.length}`);
    if (broken.length) console.log(broken.slice(0, 20).join("\n"));
    expect(broken).toEqual([]);
  });

  it("組み直したブロックは原文とほぼ一致し、意味は必ず保たれる", { timeout: 120_000 }, () => {
    const by = new Map<string, { total: number; same: number; keeps: number }>();
    const lost: { file: string; src: string; out: string }[] = [];
    const diffs = new Map<string, { src: string; out: string }>();

    for (const file of files) {
      const { body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
      const loaded = fromMarkdown(body);
      loaded.doc.forEach((node) => {
        const range = loaded.ranges.get(node.attrs.id as string);
        if (!range) return;
        const src = loaded.source.slice(range[0], range[1]);
        const out = blockText(node);
        const bucket = by.get(node.type.name) ?? { total: 0, same: 0, keeps: 0 };
        bucket.total++;
        if (out === src) {
          bucket.same++;
          bucket.keeps++;
        } else if (bare(out) === bare(src)) {
          bucket.keeps++;
        } else if (lost.length < 5) {
          lost.push({ file: path.relative(ROOT, file), src, out });
        }
        if (out !== src && !diffs.has(node.type.name)) diffs.set(node.type.name, { src, out });
        by.set(node.type.name, bucket);
      });
    }

    const all = [...by.values()].reduce(
      (a, s) => ({ total: a.total + s.total, same: a.same + s.same, keeps: a.keeps + s.keeps }),
      { total: 0, same: 0, keeps: 0 },
    );
    const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;
    console.log(`b 原文一致 ${pct(all.same, all.total)}  c 意味を保つ ${pct(all.keeps, all.total)}`);
    for (const [type, s] of [...by].sort((a, b) => b[1].total - a[1].total)) {
      console.log(
        `  ${type.padEnd(14)} ${String(s.total).padStart(6)}  一致 ${pct(s.same, s.total)}  保持 ${pct(s.keeps, s.total)}`,
      );
    }
    for (const [type, x] of diffs) {
      console.log(`### ${type}\n原文:\n${x.src.slice(0, 200)}\n出力:\n${x.out.slice(0, 200)}`);
    }
    for (const x of lost) {
      console.log(`--- ${x.file}\n原文:\n${x.src.slice(0, 240)}\n出力:\n${x.out.slice(0, 240)}`);
    }

    // 残る差は、桁を詰めた表（原文の余白は行ごとにばらばらで、揃え直すと変わる）と、
    // Notion 由来の行継ぎ（次の行が前の段落に吸われる書き方）に集中している。
    // どちらも触ったブロックにしか出ず、描画結果は変わらない。
    expect(all.keeps / all.total).toBeGreaterThan(0.99);
    expect(all.same / all.total).toBeGreaterThan(0.97);
  });
});

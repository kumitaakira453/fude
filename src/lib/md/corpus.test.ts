import fs from "node:fs";
import path from "node:path";
import { Fragment, type Node as PmNode } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../frontmatter";
import { fromMarkdown, parseTree } from "./fromMarkdown";
import { toMarkdown, blockText } from "./toMarkdown";
import { sameShape, spliceNode } from "./splice";

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

// 1 文字書き足したときに、そこだけが動くかを見るための印。
// 逃がしも行送りも起こさない文字を選ぶ。
const MARK = "Ω";

// 最初に出てくる文字列に印を足した写しを返す。文字列が無ければ null。
function mark(node: PmNode): PmNode | null {
  if (node.isText) return node.type.schema.text((node.text ?? "") + MARK, node.marks);
  const children: PmNode[] = [];
  let done = false;
  node.forEach((child) => {
    if (done) {
      children.push(child);
      return;
    }
    const next = mark(child);
    if (next) {
      done = true;
      children.push(next);
      return;
    }
    children.push(child);
  });
  return done ? node.copy(Fragment.fromArray(children)) : null;
}

describe.skipIf(!fs.existsSync(ROOT))("実データ", () => {
  const files = walk(ROOT);

  it("無編集の往復は原文と一致する", { timeout: 600_000 }, () => {
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

  it("組み直したブロックは原文とほぼ一致し、意味は必ず保たれる", { timeout: 600_000 }, () => {
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

    // 残る差は 3 つに集中している。桁を詰めた表（原文の余白は行ごとにばらばらで、
    // 揃え直すと変わる）、Notion 由来の行継ぎ（次の行が前の段落に吸われる書き方）、
    // 段落の途中の折り返し（編集モデルでは空白 1 つなので、組み直すと 1 行になる）。
    // どれも触ったブロックにしか出ず、描画結果は変わらない。
    //
    // 折り返しは打っている間は保たれる（差し込みの経路が原文の改行を残す）。
    // 潰れるのは形が変わる編集で、ブロックを丸ごと組み直したときだけ。下の
    // 「1 文字の書き換え」が、打つ分には 1 文字しか動かないことを見ている。
    expect(all.keeps / all.total).toBeGreaterThan(0.95);
    expect(all.same / all.total).toBeGreaterThan(0.94);
  });

  it("1 文字の書き換えは、その 1 文字だけの差分になる", { timeout: 300_000 }, () => {
    let total = 0;
    let exact = 0;
    const off = new Map<string, number>();
    const samples: { file: string; type: string; diff: string }[] = [];

    for (const file of files) {
      const { body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
      const loaded = fromMarkdown(body);
      const blocks: PmNode[] = [];
      loaded.doc.forEach((node) => blocks.push(node));

      blocks.forEach((node, index) => {
        const marked = mark(node);
        if (!marked) return;
        total++;
        const next = loaded.doc.copy(
          Fragment.fromArray(blocks.map((b, i) => (i === index ? marked : b))),
        );
        const out = toMarkdown(next, loaded);
        if (out.replaceAll(MARK, "") === body) {
          exact++;
          return;
        }
        const id = node.attrs.id as string;
        const spliced = spliceNode(
          loaded.originals.get(id)!,
          marked,
          loaded.spans.get(id)!,
          loaded.source,
        );
        const why =
          spliced === null
            ? "形が合わない"
            : sameShape(fromMarkdown(spliced).doc.child(0), marked)
              ? "差し込めたのにずれる"
              : "読み直すと違う";
        off.set(`${node.type.name}/${why}`, (off.get(`${node.type.name}/${why}`) ?? 0) + 1);
        if (samples.length < 6) {
          const plain = out.replaceAll(MARK, "");
          let i = 0;
          while (i < plain.length && i < body.length && plain[i] === body[i]) i++;
          samples.push({
            file: path.relative(ROOT, file),
            type: node.type.name,
            diff: `原文: ${body.slice(i, i + 90)}\n出力: ${plain.slice(i, i + 90)}`,
          });
        }
      });
    }

    console.log(`d: ${((exact / total) * 100).toFixed(2)}%（${exact} / ${total}）`);
    for (const [type, n] of [...off].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type.padEnd(14)} ${n} 件ずれる`);
    }
    for (const x of samples) console.log(`--- ${x.file} (${x.type})\n${x.diff}`);

    expect(exact).toBe(total);
  });
});

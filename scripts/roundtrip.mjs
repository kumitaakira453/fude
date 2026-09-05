// 原文保持つき直列化が成立するかを測る。
//
// 全文編集を編集モデル（ProseMirror 系）へ移すと、保存のたびに Markdown を
// 組み直すことになる。素直に組み直すと触っていない段落まで書式が正規化され、
// git 差分が使いものにならない。逃げ道は「触られていないノードは直列化せず、
// 元のソースをそのまま出す」で、それが成り立つかをここで測る。
//
//   測定 A: ノードの position が原文を隙間なく覆っているか（原文スライスの前提）
//   測定 B: ノード単体を直列化した結果が原文とどれだけ一致するか（差分ノイズの量）
//
// パーサ構成は src/lib/projection.ts と同一。remark-cjk-friendly を外すと
// 「**強調**を」のような日本語の太字で境界がずれ、測定が意味を失う。

import fs from "node:fs";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkMath from "remark-math";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";

const ROOT = "/Users/kumitaakira/demia_works/wasurenai/monorepo-docs";
const OUT = path.join(import.meta.dirname, "out");

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(remarkMath);

// 直列化の設定 2 本。既定値と、実データの書き方へ寄せた値。
// 実データは箇条書き "-" が 26,265 行に対し "*" が 28 行、強調は "**"、
// 水平線は "---" が優勢なので、寄せる先はそこ。
const EXTENSIONS = [gfmToMarkdown(), mathToMarkdown()];
const VARIANTS = {
  default: { extensions: EXTENSIONS },
  tuned: {
    extensions: EXTENSIONS,
    bullet: "-",
    bulletOther: "*",
    emphasis: "*",
    strong: "*",
    fence: "`",
    fences: true,
    rule: "-",
    listItemIndent: "one",
    tightDefinitions: true,
  },
};

// src/lib/frontmatter.ts と同じ切り出し。本文は raw の suffix になる。
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const bodyOf = (text) => {
  const m = text.match(FM_RE);
  return m ? text.slice(m[0].length) : text;
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      walk(p, out);
    } else if (e.name.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

// ---- 測定 A ----

// ノードが原文を順に、重なりなく覆っているか。覆えていれば
// 「触っていないノードは原文スライスで出す」がそのまま成り立つ。
function coverage(body, tree) {
  let cursor = 0;
  for (const node of tree.children) {
    const pos = node.position;
    if (!pos || pos.start.offset === undefined || pos.end.offset === undefined) {
      return { ok: false, why: "position なし", type: node.type };
    }
    if (pos.start.offset < cursor) {
      return { ok: false, why: "範囲が重なる", type: node.type };
    }
    if (pos.end.offset > body.length) {
      return { ok: false, why: "範囲が本文を超える", type: node.type };
    }
    // ノードの間は空行など。原文から取るので中身は問わない。
    cursor = pos.end.offset;
  }
  return { ok: true };
}

// ---- 測定 B ----

// 不一致の理由を切り分ける。順に潰していき、最初に当たったものを返す。
function classify(src, out) {
  const bullets = (s) => s.replace(/^(\s*)[*+-](\s)/gm, "$1-$2");
  const rules = (s) => s.replace(/^\s*([*_-])\1{2,}\s*$/gm, "---");
  const marks = (s) => s.replace(/__/g, "**").replace(/(?<!\*)_(?!_)/g, "*");
  const escapes = (s) => s.replace(/\\([-*_#[\]()<>`~.+!|])/g, "$1");
  const pipes = (s) =>
    s
      .split("\n")
      .map((l) => (l.includes("|") ? l.replace(/\s*\|\s*/g, "|").replace(/-+/g, "-") : l))
      .join("\n");
  const spaces = (s) => s.replace(/^[ \t]+/gm, "").replace(/[ \t]+$/gm, "");
  const blanks = (s) => s.replace(/\n{2,}/g, "\n");

  const tests = [
    ["箇条書きの記号", bullets],
    ["水平線の記号", rules],
    ["強調の記号", marks],
    ["エスケープ", escapes],
    ["表の桁揃え", pipes],
    ["行頭・行末の空白", spaces],
    ["空行の数", blanks],
  ];
  for (const [why, f] of tests) {
    if (f(src) === f(out)) return why;
  }
  // 複数が絡んでいる場合。全部かけて一致するなら「書式の揺れ（複合）」。
  const all = (s) => blanks(spaces(pipes(escapes(marks(rules(bullets(s)))))));
  if (all(src) === all(out)) return "書式の揺れ（複合）";
  return "構造が変わる";
}

const stats = () => ({ total: 0, match: 0, reasons: {}, samples: [] });

function measure(files) {
  const result = {
    files: { total: 0, coverageOk: 0, failures: [] },
    nodes: { default: {}, tuned: {} },
  };

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const body = bodyOf(raw);
    let tree;
    try {
      tree = processor.parse(body);
    } catch (e) {
      result.files.failures.push({ file, why: `parse 失敗: ${e.message}` });
      result.files.total++;
      continue;
    }

    result.files.total++;
    const cov = coverage(body, tree);
    if (cov.ok) result.files.coverageOk++;
    else result.files.failures.push({ file, ...cov });

    for (const node of tree.children) {
      const pos = node.position;
      if (pos?.start.offset === undefined || pos.end.offset === undefined) continue;
      const src = body.slice(pos.start.offset, pos.end.offset);

      for (const [variant, options] of Object.entries(VARIANTS)) {
        const bucket = (result.nodes[variant][node.type] ??= stats());
        bucket.total++;
        let out;
        try {
          out = toMarkdown(node, options).replace(/\n+$/, "");
        } catch (e) {
          bucket.reasons["直列化で例外"] = (bucket.reasons["直列化で例外"] ?? 0) + 1;
          continue;
        }
        if (out === src) {
          bucket.match++;
          continue;
        }
        const why = classify(src, out);
        bucket.reasons[why] = (bucket.reasons[why] ?? 0) + 1;
        // 実例は理由ごとに残す。率だけでは、直せる崩れか直せない崩れかが分からない。
        if (variant === "tuned") {
          const kept = bucket.samples.filter((x) => x.why === why).length;
          if (kept < 2) {
            bucket.samples.push({ file, why, src: src.slice(0, 400), out: out.slice(0, 400) });
          }
        }
      }
    }
  }
  return result;
}

// ---- 出力 ----

const pct = (a, b) => (b === 0 ? "—" : `${((a / b) * 100).toFixed(1)}%`);

function table(nodes) {
  const rows = Object.entries(nodes).sort((a, b) => b[1].total - a[1].total);
  const lines = ["| 種別 | ノード数 | 一致 | 一致率 | 主な理由 |", "|---|---:|---:|---:|---|"];
  for (const [type, s] of rows) {
    const top = Object.entries(s.reasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([w, n]) => `${w} ${n}`)
      .join(" / ");
    lines.push(`| ${type} | ${s.total} | ${s.match} | ${pct(s.match, s.total)} | ${top || "—"} |`);
  }
  return lines.join("\n");
}

function report(main, snapshots) {
  const rel = (p) => path.relative(ROOT, p);
  const sum = (nodes) =>
    Object.values(nodes).reduce((a, s) => ({ total: a.total + s.total, match: a.match + s.match }), {
      total: 0,
      match: 0,
    });

  const d = sum(main.nodes.default);
  const t = sum(main.nodes.tuned);

  const parts = [
    "# 往復実験の結果",
    "",
    "原文保持つき直列化が成立するかの測定。母集団は monorepo-docs の Markdown。",
    "",
    "## 母集団",
    "",
    `- 本集計: ${main.files.total} ファイル`,
    `- 参考（\`.snapshots/\` 配下）: ${snapshots.files.total} ファイル`,
    "",
    "## 測定 A — 原文カバレッジ",
    "",
    `ノードの position が原文を順に重なりなく覆っているか。**${pct(main.files.coverageOk, main.files.total)}**` +
      `（${main.files.coverageOk} / ${main.files.total}）`,
    "",
  ];

  if (main.files.failures.length) {
    parts.push("崩れたファイル", "");
    for (const f of main.files.failures.slice(0, 40)) {
      parts.push(`- \`${rel(f.file)}\` — ${f.why}${f.type ? `（${f.type}）` : ""}`);
    }
    if (main.files.failures.length > 40) {
      parts.push(`- ほか ${main.files.failures.length - 40} 件`);
    }
    parts.push("");
  }

  // 潰せる崩れを外すとどこまで上がるか。設計判断はこの数字で行う。
  // エスケープは unsafe パターンの調整で消せる。表は原文の桁揃えを保つ
  // 自前の書き出し（blocks.ts のパイプ操作）に寄せれば触らずに済む。
  const lift = (pick) =>
    Object.entries(main.nodes.tuned).reduce(
      (a, [type, s]) => {
        a.total += s.total;
        a.match += s.match + pick(type, s);
        return a;
      },
      { total: 0, match: 0 },
    );
  const noEscape = lift((_, s) => s.reasons["エスケープ"] ?? 0);
  const keepTable = lift((type, s) => (type === "table" ? s.total - s.match : 0));
  const both = lift(
    (type, s) => (type === "table" ? s.total - s.match : (s.reasons["エスケープ"] ?? 0)),
  );

  parts.push(
    "## 測定 B — ノード単位の直列化忠実度",
    "",
    `全体: 既定値 **${pct(d.match, d.total)}**（${d.match} / ${d.total}）、` +
      `原文へ寄せた設定 **${pct(t.match, t.total)}**（${t.match} / ${t.total}）`,
    "",
    "### 原文へ寄せた設定",
    "",
    table(main.nodes.tuned),
    "",
    "### 既定値",
    "",
    table(main.nodes.default),
    "",
    "## 潰せる崩れを外したとき",
    "",
    "| 対策 | 一致率 |",
    "|---|---:|",
    `| なし | ${pct(t.match, t.total)} |`,
    `| エスケープを抑える | ${pct(noEscape.match, noEscape.total)} |`,
    `| 表は原文を保つ | ${pct(keepTable.match, keepTable.total)} |`,
    `| 両方 | ${pct(both.match, both.total)} |`,
    "",
    "## 不一致の実例",
    "",
  );

  for (const [type, s] of Object.entries(main.nodes.tuned).sort((a, b) => b[1].total - a[1].total)) {
    if (!s.samples.length) continue;
    parts.push(`### ${type}`, "");
    for (const x of s.samples) {
      parts.push(
        `**${x.why}** — \`${rel(x.file)}\``,
        "",
        "原文",
        "",
        "```",
        x.src,
        "```",
        "",
        "直列化",
        "",
        "```",
        x.out,
        "```",
        "",
      );
    }
  }

  return parts.join("\n");
}

// ---- 実行 ----

const all = walk(ROOT);
const isSnapshot = (p) => p.includes(`${path.sep}.snapshots${path.sep}`);
const main = measure(all.filter((p) => !isSnapshot(p)));
const snapshots = measure(all.filter(isSnapshot));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "report.md"), report(main, snapshots));
fs.writeFileSync(path.join(OUT, "raw.json"), JSON.stringify({ main, snapshots }, null, 2));

const sum = (nodes) =>
  Object.values(nodes).reduce((a, s) => ({ total: a.total + s.total, match: a.match + s.match }), {
    total: 0,
    match: 0,
  });
const t = sum(main.nodes.tuned);
console.log(`ファイル ${main.files.total} 件`);
console.log(`測定 A: ${pct(main.files.coverageOk, main.files.total)}（崩れ ${main.files.failures.length} 件）`);
console.log(`測定 B: ${pct(t.match, t.total)}（${t.match} / ${t.total} ノード）`);
console.log(path.join(OUT, "report.md"));

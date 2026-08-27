import { appendFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { splitBlocks } from "./blocks";
import { buildProjection, findPlain, plainToSrcRange } from "./projection";

// 射影が満たすべき不変条件。exact なブロックでは plain の 1 文字ごとに
// 対応するソース位置の文字が一致し、オフセットは単調非減少になる。
function assertInvariants(src: string, label: string) {
  const p = buildProjection(src);
  expect(p.srcOffsets.length, `${label}: 長さ`).toBe(p.plain.length);
  for (let i = 1; i < p.srcOffsets.length; i++) {
    expect(
      p.srcOffsets[i] >= p.srcOffsets[i - 1],
      `${label}: オフセットが後退した (i=${i})`,
    ).toBe(true);
  }
  if (p.exact) {
    for (let i = 0; i < p.plain.length; i++) {
      expect(
        src[p.srcOffsets[i]],
        `${label}: ${i} 文字目が一致しない`,
      ).toBe(p.plain[i]);
    }
  }
  return p;
}

describe("buildProjection", () => {
  it("素の段落はそのまま対応する", () => {
    const p = assertInvariants("ふつうの段落です。", "段落");
    expect(p.plain).toBe("ふつうの段落です。");
    expect(p.srcOffsets[0]).toBe(0);
    expect(p.exact).toBe(true);
  });

  it("見出しの記号を含めない", () => {
    const p = assertInvariants("## 背景", "見出し");
    expect(p.plain).toBe("背景");
    expect(p.srcOffsets[0]).toBe(3);
  });

  it("閉じ記号の直後が CJK の太字でもソース位置が合う", () => {
    // remark-cjk-friendly が無いと太字が成立せず ** が本文に混ざる
    const src = "**強調**を含む文";
    const p = assertInvariants(src, "CJK 太字");
    expect(p.plain).toBe("強調を含む文");
    expect(src.slice(p.srcOffsets[0], p.srcOffsets[1] + 1)).toBe("強調");
  });

  it("インラインコードは囲みのバッククォートを含めない", () => {
    const p = assertInvariants("設定は `member_basic_field` です", "インラインコード");
    expect(p.plain).toBe("設定は member_basic_field です");
  });

  it("サロゲートペアより後ろのオフセットがずれない", () => {
    const src = "先頭 💡 ヒント";
    const p = assertInvariants(src, "絵文字");
    expect(p.plain).toBe(src);
    // 💡 は UTF-16 で 2 コード単位。以降の文字位置が 1 つずれていないこと
    const at = p.plain.indexOf("ヒント");
    expect(src.slice(p.srcOffsets[at])).toBe("ヒント");
  });

  it("エスケープされた記号は 1 文字として対応する", () => {
    const src = "アスタリスクは \\* と書く";
    const p = assertInvariants(src, "エスケープ");
    expect(p.plain).toBe("アスタリスクは * と書く");
  });

  it("表はセルの本文だけを連結する", () => {
    const src = ["| 定数名 | 値 |", "| --- | --- |", "| `EMAIL` | email |"].join("\n");
    const p = assertInvariants(src, "表");
    expect(p.plain).not.toContain("|");
    expect(p.plain).toContain("EMAIL");
  });

  it("リストは行頭の記号を含めない", () => {
    const src = "- ひとつめ\n- ふたつめ";
    const p = assertInvariants(src, "リスト");
    expect(p.plain).toBe("ひとつめふたつめ");
  });

  it("数式を含むブロックは exact を降ろす", () => {
    const p = buildProjection("式は $a^2$ である");
    expect(p.exact).toBe(false);
  });

  it("生 HTML を含むブロックは exact を降ろす", () => {
    const p = buildProjection('<span class="x">中身</span>');
    expect(p.exact).toBe(false);
  });
});

describe("plainToSrcRange", () => {
  it("太字をまたぐ選択がソース範囲に戻る", () => {
    const src = "これは**重要**な点です";
    const p = buildProjection(src);
    const at = p.plain.indexOf("重要な点");
    const r = plainToSrcRange(p, at, at + "重要な点".length);
    // ソース範囲には囲み記号が含まれるが、選択した本文を必ず覆う
    expect(src.slice(r.start, r.end)).toContain("重要");
    expect(src.slice(r.start, r.end)).toContain("な点");
  });
});

describe("findPlain", () => {
  it("同じ文字列が複数あるとき hint に近い方を選ぶ", () => {
    const plain = "ありがとうありがとうありがとう";
    expect(findPlain(plain, "ありがとう", 0)?.start).toBe(0);
    expect(findPlain(plain, "ありがとう", 11)?.start).toBe(10);
  });

  it("見つからなければ null", () => {
    expect(findPlain("あいうえお", "かきく")).toBeNull();
  });
});

// 実運用の文書に対する検証。対象は環境変数で渡し、無ければスキップする。
//   MDGLOW_CORPUS=/path/to/docs MDGLOW_REPORT=/tmp/p0.txt npx vitest run
const corpus = process.env.MDGLOW_CORPUS;

// 集計値は標準出力ではなくファイルに残す。テストランナーが
// コンソール出力を握るため、後から確実に読める形にしておく。
function report(...lines: string[]) {
  const dest = process.env.MDGLOW_REPORT;
  if (dest) appendFileSync(dest, `${lines.join("\n")}\n`, "utf8");
}

function collectMarkdown(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) collectMarkdown(abs, out);
    else if (name.endsWith(".md")) out.push(abs);
  }
  return out;
}

describe.skipIf(!corpus)("実文書での射影", () => {
  it("全ブロックで不変条件が成り立ち、exact 率を報告する", { timeout: 600_000 }, () => {
    const files = collectMarkdown(corpus as string);
    let total = 0;
    let exact = 0;
    const inexactTypes = new Map<string, number>();

    for (const abs of files) {
      const body = readFileSync(abs, "utf8");
      for (const b of splitBlocks(body)) {
        if (!b.src.trim()) continue;
        const p = assertInvariants(b.src, `${abs} #${b.index}`);
        total++;
        if (p.exact) exact++;
        else inexactTypes.set(b.type, (inexactTypes.get(b.type) ?? 0) + 1);
      }
    }

    const rate = ((exact / total) * 100).toFixed(1);
    const breakdown = [...inexactTypes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}=${n}`)
      .join(" ");
    report(
      `射影: ${files.length} ファイル / ${total} ブロック / exact ${exact} (${rate}%)`,
      `射影: exact でない内訳: ${breakdown || "なし"}`,
    );
    expect(total).toBeGreaterThan(0);
  });

  it("編集用のブロック分割と描画用の分割が一致する", { timeout: 600_000 }, () => {
    // splitBlocks は remarkParse + remarkGfm のみ。描画側は cjk-friendly と math を
    // 足すため、$$ 数式のあるファイルで境界が食い違う可能性がある
    const files = collectMarkdown(corpus as string);
    const mismatched: string[] = [];
    for (const abs of files) {
      const body = readFileSync(abs, "utf8");
      const editBoundaries = splitBlocks(body).map((b) => `${b.start}:${b.end}`);
      const renderBoundaries = splitBlocksLikeRenderer(body);
      if (editBoundaries.join(",") !== renderBoundaries.join(",")) mismatched.push(abs);
    }
    report(
      `分割: 境界が食い違うファイル ${mismatched.length} / ${files.length}`,
      ...mismatched.slice(0, 5).map((f) => `分割: ${f}`),
    );
    expect(mismatched.length).toBe(0);
  });
});

// 描画側と同じプラグイン構成でトップレベルのブロック境界を出す。
const rendererProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(remarkMath);

function splitBlocksLikeRenderer(body: string): string[] {
  const tree = rendererProcessor.parse(body) as {
    children: { position?: { start: { offset?: number }; end: { offset?: number } } }[];
  };
  return tree.children.map(
    (n) => `${n.position?.start.offset ?? 0}:${n.position?.end.offset ?? body.length}`,
  );
}

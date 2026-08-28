import type { Block } from "./blocks";

// 2 つの版をトップレベルのブロック単位で突き合わせる。
//
// 行単位で比較しない。散文は 1 段落がソースの 1 行なので、行差分では
// 「段落全体が変わった」しか分からず、どこがどう変わったのか読み取れない。
// ブロック単位なら、変更前と変更後をそれぞれ描画して並べられる。

export type BlockChange =
  | { kind: "same"; base: Block; head: Block }
  | { kind: "changed"; base: Block; head: Block }
  | { kind: "added"; head: Block }
  | { kind: "removed"; base: Block };

export function diffBlocks(base: Block[], head: Block[]): BlockChange[] {
  const pairs = matchedPairs(
    base.map((b) => b.src),
    head.map((b) => b.src),
  );
  const out: BlockChange[] = [];
  let bi = 0;
  let hi = 0;

  const flushGap = (untilBase: number, untilHead: number) => {
    // 一致しない区間は、順番に 1 対 1 で「変更」として組み、
    // 余った分を追加・削除として出す
    while (bi < untilBase && hi < untilHead) {
      out.push({ kind: "changed", base: base[bi++], head: head[hi++] });
    }
    while (bi < untilBase) out.push({ kind: "removed", base: base[bi++] });
    while (hi < untilHead) out.push({ kind: "added", head: head[hi++] });
  };

  for (const [pb, ph] of pairs) {
    flushGap(pb, ph);
    out.push({ kind: "same", base: base[bi++], head: head[hi++] });
  }
  flushGap(base.length, head.length);
  return out;
}

// 指摘が今の版でどうなっているか。
//
// 指摘は「付けた時点の版」の中では位置が確定している。その版は指摘作成時に
// 画面に出ていた全文をそのまま保存しているので、基準版側の照合は必ず当たる。
// 現在位置は探すのではなく、基準版のブロック → 対応付け → 現在のブロックと辿って
// 導出する。現在の本文から引用文字列を探す方法は、指摘に応えて本文が
// 書き換えられた瞬間に失敗する（この機能がいちばん働くべき場面で位置を失う）。
export type Resolution =
  | { state: "unchanged"; index: number; head: Block }
  | { state: "rewritten"; index: number; base: Block; head: Block }
  | { state: "removed"; index: number; base: Block }
  | { state: "unknown"; index: number };

export function resolveInDiff(
  diff: BlockChange[],
  quote: string,
  selection = "",
): Resolution {
  const index = targetIndex(diff, quote, selection);
  if (index < 0) return { state: "unknown", index };
  const change = diff[index];
  switch (change.kind) {
    case "same":
      return { state: "unchanged", index, head: change.head };
    case "changed":
      return { state: "rewritten", index, base: change.base, head: change.head };
    case "removed":
      return { state: "removed", index, base: change.base };
    default:
      // added は基準版側を持たないので targetIndex では選ばれない
      return { state: "unknown", index: -1 };
  }
}

// 解決結果のうち、今の版に現れているブロック。印を付ける位置に使う。
export function headOf(resolution: Resolution): Block | null {
  return resolution.state === "unchanged" || resolution.state === "rewritten"
    ? resolution.head
    : null;
}

// 指摘が付いていたブロックが、差分の何番目にあたるかを返す。無ければ -1。
//
// quote はブロック本文の逐語コピー。指摘を付けた時点の記録なので当たれば確実。
// 別アプリから取り込んだ指摘はブロック本文ではなく「画面に出ていた文字列」を
// 持っており、記法（**、バッククォート、表の |、行頭記号）が落ちているため
// ソースと素朴に比べても当たらない。段階的に緩めて照合する。
//
// 緩い照合では、候補が一意に決まらなければ特定できなかったものとして扱う。
// 短い文はどの文書にも複数現れるので、無理に当てると別の箇所を指してしまう。
export function targetIndex(diff: BlockChange[], quote: string, selection = ""): number {
  const exact = indicesWhere(diff, (src) => src === quote);
  // 内容が同じブロックが複数あるときは先頭を採る。逐語一致なのでどれでも同じ本文
  if (exact.length > 0) return exact[0];

  const text = (selection || quote).trim();
  if (!text) return -1;

  const contains = indicesWhere(diff, (src) => src.includes(text));
  if (contains.length === 1) return contains[0];

  const probe = stripMarkup(text).slice(0, PROBE_LENGTH);
  if (!probe) return -1;
  const loose = indicesWhere(diff, (src) => stripMarkup(src).includes(probe));
  return loose.length === 1 ? loose[0] : -1;
}

const PROBE_LENGTH = 24;

function indicesWhere(diff: BlockChange[], match: (src: string) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < diff.length; i++) {
    const change = diff[i];
    if ("base" in change && match(change.base.src)) out.push(i);
  }
  return out;
}

// 突き合わせ用に記法と空白の違いを均す。描画結果を復元するものではなく、
// 同じ箇所かどうかを判定するためだけの正規化。
function stripMarkup(src: string): string {
  return src
    .replace(/```[^\n]*\n?/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// 最長共通部分列をとり、一致したブロックの添字の組を返す。
function matchedPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

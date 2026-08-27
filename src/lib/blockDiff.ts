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

// 指摘が付いていたブロックが、差分の何番目にあたるかを返す。無ければ -1。
//
// quote はブロック本文の逐語コピー。これで当たれば確実。
// 別アプリから取り込んだ指摘はブロック本文ではなく「画面に出ていた文字列」を
// 持っており、記法（**、バッククォート、表の |、行頭の記号）が落ちているため
// ソースと素朴に比べても当たらない。最後の手段として双方から記法を落として比べる。
export function targetIndex(diff: BlockChange[], quote: string, selection = ""): number {
  for (let i = 0; i < diff.length; i++) {
    const change = diff[i];
    if ("base" in change && change.base.src === quote) return i;
  }

  const text = (selection || quote).trim();
  if (!text) return -1;

  for (let i = 0; i < diff.length; i++) {
    const change = diff[i];
    if ("base" in change && change.base.src.includes(text)) return i;
  }

  // 選択が複数ブロックにまたがっていることもあるので、先頭の一部で当てる
  const probe = stripMarkup(text).slice(0, PROBE_LENGTH);
  if (probe.length < MIN_PROBE_LENGTH) return -1;
  for (let i = 0; i < diff.length; i++) {
    const change = diff[i];
    if ("base" in change && stripMarkup(change.base.src).includes(probe)) return i;
  }
  return -1;
}

const PROBE_LENGTH = 24;
const MIN_PROBE_LENGTH = 6;

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

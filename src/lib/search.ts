import type { TreeNode } from "./fsAccess";

// ---- クイックオープン（ファイル名ファジー検索） ----
export interface FuzzyResult {
  node: TreeNode;
  score: number;
  matches: number[]; // マッチした文字位置（path 上）
}

// 部分列マッチのシンプルなファジースコアリング。
// 連続一致・単語頭一致・浅い階層を高評価する。
export function fuzzyMatch(query: string, target: string): { score: number; matches: number[] } | null {
  if (!query) return { score: 0, matches: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let prevIdx = -2;
  const matches: number[] = [];
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matches.push(ti);
      score += ti === prevIdx + 1 ? 8 : 1; // 連続一致ボーナス
      if (ti === 0 || /[\/\s._-]/.test(t[ti - 1])) score += 6; // 単語頭ボーナス
      prevIdx = ti;
      qi++;
    }
  }
  if (qi < q.length) return null;
  score -= target.length * 0.05; // 短いパスを優遇
  return { score, matches };
}

// 触った新しさの加点。今なら 1 割で、そこから 1 日ごとに半分になる。
// 加点は「その一致の強さ」に比例させる。固定の点数にすると、名前が弱く
// 引っかかっただけのものが、新しいという理由で正確な一致を追い抜く。
const RECENT_RATE = 0.1;
const HALF_LIFE = 24 * 60 * 60 * 1000;

export function recencyBonus(
  score: number,
  mtime: number | undefined,
  now: number,
): number {
  if (!mtime) return 0;
  const decay = 0.5 ** (Math.max(0, now - mtime) / HALF_LIFE);
  return Math.max(1, Math.abs(score)) * RECENT_RATE * decay;
}

export interface QuickOpenOpts {
  // path -> 最後に触られた時刻。無ければ名前の一致だけで並ぶ。
  touched?: Map<string, number>;
  now?: number;
  limit?: number;
}

// 絞り込みが空のときは新しく触ったものから並べる。開いた直後に出るのは
// 「さっきまで書いていたファイル」であってほしい。
// 絞り込みがあるときは名前の一致を主に、新しさを添えて順を決める。
export function quickOpen(
  files: TreeNode[],
  query: string,
  opts: QuickOpenOpts = {},
): FuzzyResult[] {
  const { touched, now = Date.now(), limit = 40 } = opts;
  const results: FuzzyResult[] = [];
  for (const node of files) {
    const m = fuzzyMatch(query, node.path);
    if (!m) continue;
    const bonus = query ? recencyBonus(m.score, touched?.get(node.path), now) : 0;
    results.push({ node, score: m.score + bonus, matches: m.matches });
  }
  if (query) {
    results.sort((a, b) => b.score - a.score);
  } else {
    results.sort(
      (a, b) =>
        (touched?.get(b.node.path) ?? 0) - (touched?.get(a.node.path) ?? 0),
    );
  }
  return results.slice(0, limit);
}

// ---- 全文検索 ----
export interface ContentHit {
  path: string;
  line: number; // 1-based
  column: number; // 0-based（マッチ開始）
  length: number;
  preview: string;
}

export interface FileHits {
  path: string;
  hits: ContentHit[];
}

export interface SearchOptions {
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean;
}

export function buildMatcher(query: string, opts: SearchOptions): RegExp | null {
  if (!query) return null;
  const flags = opts.caseSensitive ? "g" : "gi";
  try {
    let pattern = opts.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (opts.wholeWord) pattern = `\\b(?:${pattern})\\b`;
    return new RegExp(pattern, flags);
  } catch {
    return null; // 不正な正規表現
  }
}

const MAX_HITS_PER_FILE = 50;

export function searchContents(
  cache: Map<string, string>,
  query: string,
  opts: SearchOptions,
): { results: FileHits[]; total: number; error: boolean } {
  const matcher = buildMatcher(query, opts);
  if (!matcher) return { results: [], total: 0, error: !!query };
  const results: FileHits[] = [];
  let total = 0;
  for (const [path, text] of cache) {
    const lines = text.split("\n");
    const hits: ContentHit[] = [];
    for (let i = 0; i < lines.length && hits.length < MAX_HITS_PER_FILE; i++) {
      const line = lines[i];
      matcher.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = matcher.exec(line)) !== null) {
        hits.push({
          path,
          line: i + 1,
          column: m.index,
          length: m[0].length || 1,
          preview: line.length > 240 ? line.slice(0, 240) : line,
        });
        total++;
        if (m.index === matcher.lastIndex) matcher.lastIndex++; // 空マッチ対策
        if (hits.length >= MAX_HITS_PER_FILE) break;
      }
    }
    if (hits.length > 0) results.push({ path, hits });
  }
  results.sort((a, b) => a.path.localeCompare(b.path, "ja", { numeric: true }));
  return { results, total, error: false };
}

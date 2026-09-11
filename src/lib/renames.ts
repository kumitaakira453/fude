// 消えたパスと現れたパスを突き合わせて、名前が変わった組を出す。
//
// ファイルの監視は「名前が変わった」ではなく「古い名前が消えた」「新しい名前が
// 現れた」として届く（届く順も別々のこともある）。開いているタブを新しい名前へ
// 付け替えるには、この 2 つを組にする必要がある。
//
// 当てずっぽうで組むと、無関係な作成と削除が重なったときに中身が入れ替わって
// 見える。組むのは迷いの無いときだけにする。

export function pairRenames(
  missing: string[],
  appeared: string[],
): [string, string][] {
  const left = [...new Set(missing)];
  const right = [...new Set(appeared)];
  if (!left.length || !right.length) return [];

  const out: [string, string][] = [];
  const taken = new Set<string>();

  // 同じファイル名なら、置き場所が変わっただけ（移動）。
  for (const from of left) {
    const name = baseOf(from);
    const hit = right.filter((to) => !taken.has(to) && baseOf(to) === name);
    if (hit.length !== 1) continue;
    taken.add(hit[0]);
    out.push([from, hit[0]]);
  }

  // 残りが 1 対 1 なら、名前が変わったと見る。
  const restFrom = left.filter((from) => !out.some(([f]) => f === from));
  const restTo = right.filter((to) => !taken.has(to));
  if (restFrom.length === 1 && restTo.length === 1) {
    out.push([restFrom[0], restTo[0]]);
  }

  return out;
}

const baseOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

// 消えた合図と現れた合図は、別々の回に届くことがある。その回だけで見ると
// どちらも片割れしか無く、組にならない。組めなかった名前をしばらく覚えておき、
// 次の回の相手と突き合わせる。
//
// 覚えておく間を区切るのは、無関係な作成と削除を後から組まないため。

// 覚えておく間（ミリ秒）。
export const RECALL = 3000;

export interface RenameMemo {
  // 消えたまま組めていない名前と、消えた時刻。
  lost: Map<string, number>;
  // 現れたまま組めていない名前と、現れた時刻。
  found: Map<string, number>;
}

export const newRenameMemo = (): RenameMemo => ({
  lost: new Map(),
  found: new Map(),
});

export function matchRenames(
  memo: RenameMemo,
  at: {
    // この回で消えた名前・現れた名前。
    missing: string[];
    born: string[];
    // いま在るファイル。覚え書きの片付けに使う。
    present: Set<string>;
    now: number;
  },
): [string, string][] {
  forget(memo, at.now);
  // 在り直した名前は消えていない。無くなった名前は現れていない。
  for (const p of [...memo.lost.keys()]) if (at.present.has(p)) memo.lost.delete(p);
  for (const p of [...memo.found.keys()]) if (!at.present.has(p)) memo.found.delete(p);

  const missing = [...new Set([...memo.lost.keys(), ...at.missing])];
  const born = [...new Set([...memo.found.keys(), ...at.born])];
  const pairs = pairRenames(missing, born);

  const took = new Set(pairs.flat());
  for (const p of missing) {
    if (took.has(p) || at.present.has(p)) memo.lost.delete(p);
    else if (!memo.lost.has(p)) memo.lost.set(p, at.now);
  }
  for (const p of born) {
    if (took.has(p) || !at.present.has(p)) memo.found.delete(p);
    else if (!memo.found.has(p)) memo.found.set(p, at.now);
  }
  return pairs;
}

function forget(memo: RenameMemo, now: number): void {
  for (const [p, at] of [...memo.lost]) if (now - at > RECALL) memo.lost.delete(p);
  for (const [p, at] of [...memo.found]) if (now - at > RECALL) memo.found.delete(p);
}

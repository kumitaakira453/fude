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

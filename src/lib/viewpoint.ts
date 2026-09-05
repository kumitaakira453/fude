// ファイルごとに「見ていた場所」を覚える。位置は本文の先頭からの文字数で持つ
// （割合は組まれた高さが変わると別の場所を指す）。
//
// 文字数だけだとブロックの頭にしか戻れない。長い表の途中を見ていたのに
// 表の先頭が上端に来てしまうので、そのブロックへどれだけ入り込んでいたかも
// 画素で控える。
//
// ペインの外に置くのは、レビュー画面が本文の木ごと差し替えるため。
// コンポーネントの ref に持つと、戻ってきた時点で控えが消えていて先頭に戻る。
export interface Viewpoint {
  // 本文の先頭からの文字数。上端に見えているブロックの頭を指す。
  at: number;
  // そのブロックの頭から、上端までの画素。0 ならブロックの頭が上端。
  into: number;
}

const seen = new Map<string, Viewpoint>();

// 覚えておく数。開いたファイルの数だけ増えるので、古いものから捨てる。
const KEEP = 64;

export function viewKey(paneId: string, path: string | null): string | null {
  return path ? `${paneId} ${path}` : null;
}

export function rememberViewpoint(
  key: string | null,
  at: number,
  into = 0,
): void {
  if (!key) return;
  // 入れ直して最近見た順に並べ替える。
  seen.delete(key);
  seen.set(key, { at, into });
  if (seen.size > KEEP) {
    const oldest = seen.keys().next();
    if (!oldest.done) seen.delete(oldest.value);
  }
}

export function recallViewpoint(key: string | null): Viewpoint {
  return (key && seen.get(key)) || { at: 0, into: 0 };
}

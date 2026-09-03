// ファイルごとに「見ていた場所」を覚える。位置は本文の先頭からの文字数で持つ
// （割合は組まれた高さが変わると別の場所を指す）。
//
// ペインの外に置くのは、レビュー画面が本文の木ごと差し替えるため。
// コンポーネントの ref に持つと、戻ってきた時点で控えが消えていて先頭に戻る。
const seen = new Map<string, number>();

// 覚えておく数。開いたファイルの数だけ増えるので、古いものから捨てる。
const KEEP = 64;

export function viewKey(paneId: string, path: string | null): string | null {
  return path ? `${paneId} ${path}` : null;
}

export function rememberViewpoint(key: string | null, offset: number): void {
  if (!key) return;
  // 入れ直して最近見た順に並べ替える。
  seen.delete(key);
  seen.set(key, offset);
  if (seen.size > KEEP) {
    const oldest = seen.keys().next();
    if (!oldest.done) seen.delete(oldest.value);
  }
}

export function recallViewpoint(key: string | null): number {
  return (key && seen.get(key)) || 0;
}

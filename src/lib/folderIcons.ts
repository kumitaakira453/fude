import declared from "material-symbols/index.d.ts?raw";

// フォルダに付けたアイコン。鍵はフォルダの絶対パス、値は Material Symbols の
// 名前。覚えるのはアプリの中だけで、フォルダには何も書かない。

export type FolderIcons = Record<string, string>;

// 選べるアイコンの名前。同梱しているフォントの型の宣言から取り出す（フォントに
// あるものだけが並ぶ）。
export const SYMBOL_NAMES: string[] = [...declared.matchAll(/^\s*"([a-z0-9_]+)",?$/gm)].map(
  (m) => m[1],
);

// 名前で絞る。空白は _ とみなし、部分一致で拾う。
export function searchSymbols(query: string, names = SYMBOL_NAMES): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "_");
  return q ? names.filter((n) => n.includes(q)) : names;
}

const under = (path: string, at: string) => path === at || path.startsWith(`${at}/`);

// from のフォルダが to へ動いた（名前を変えた）とき。from そのものと下の
// フォルダの分を、to の下へ付け替える。
export function moveFolderIcons(map: FolderIcons, from: string, to: string): FolderIcons {
  if (from === to || !Object.keys(map).some((k) => under(k, from))) return map;
  const next: FolderIcons = {};
  for (const [k, v] of Object.entries(map)) {
    next[under(k, from) ? `${to}${k.slice(from.length)}` : k] = v;
  }
  return next;
}

// at を消したとき。at そのものと下のフォルダの分を外す。
export function dropFolderIcons(map: FolderIcons, at: string): FolderIcons {
  if (!Object.keys(map).some((k) => under(k, at))) return map;
  return Object.fromEntries(Object.entries(map).filter(([k]) => !under(k, at)));
}

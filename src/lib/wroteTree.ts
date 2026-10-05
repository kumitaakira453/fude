// セッションが書いたファイルを、フォルダごとにまとめた木にする。
//
// 道筋は見せる形（根が複数なら根の名前から始まるもの）で受け取る。子が 1 つしか
// ないフォルダの連なりは 1 行に詰める（深い置き場で段が増えすぎない）。

export interface WroteFile {
  kind: "file";
  name: string;
  path: string;
  at: number;
}

export interface WroteDir {
  kind: "dir";
  // 詰めた連なりは "a/b/c" のようになる。
  name: string;
  // 開閉の鍵。見せる形の道筋。
  key: string;
  children: WroteNode[];
}

export type WroteNode = WroteFile | WroteDir;

interface Draft {
  dirs: Map<string, Draft>;
  files: WroteFile[];
}

export function wroteTree(
  wrote: readonly { path: string; at: number }[],
  label: (path: string) => string,
): WroteNode[] {
  const top: Draft = { dirs: new Map(), files: [] };
  for (const w of wrote) {
    const parts = label(w.path).split("/").filter(Boolean);
    const name = parts.pop() ?? w.path;
    let at = top;
    for (const part of parts) {
      let next = at.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        at.dirs.set(part, next);
      }
      at = next;
    }
    at.files.push({ kind: "file", name, path: w.path, at: w.at });
  }

  const build = (draft: Draft, base: string): WroteNode[] => {
    const dirs = [...draft.dirs]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, sub]): WroteDir => {
        let label = name;
        let inner = sub;
        while (inner.files.length === 0 && inner.dirs.size === 1) {
          const [[next, deeper]] = [...inner.dirs];
          label = `${label}/${next}`;
          inner = deeper;
        }
        const key = base ? `${base}/${label}` : label;
        return { kind: "dir", name: label, key, children: build(inner, key) };
      });
    const files = [...draft.files].sort((a, b) => b.at - a.at);
    return [...dirs, ...files];
  };
  return build(top, "");
}

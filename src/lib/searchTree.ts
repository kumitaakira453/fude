import type { ContentHit, FileHits } from "./search";

export type SearchTreeNode =
  | {
      type: "dir";
      name: string; // 表示名（単一子ディレクトリは "a/b" のように連結）
      path: string; // このノードの絶対パス（連結後は最深セグメント）
      children: SearchTreeNode[];
      count: number; // 配下ヒット総数
    }
  | {
      type: "file";
      name: string;
      path: string;
      hits: ContentHit[];
      count: number;
      baseGi: number; // フラットなグローバル通し番号の先頭
    };

interface DirNode {
  type: "dir";
  name: string;
  path: string;
  children: SearchTreeNode[];
  count: number;
}

// ファイル別ヒット（パス昇順）からディレクトリ階層ツリーを構築する。
// 単一ディレクトリの連鎖は "a/b/c" のように 1 ノードへ畳む（VS Code 風）。
export function buildSearchTree(
  files: FileHits[],
  baseOffsets: number[],
): SearchTreeNode[] {
  const root: DirNode = { type: "dir", name: "", path: "", children: [], count: 0 };
  files.forEach((f, fi) => {
    const segs = f.path.split("/");
    let cur = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const p = segs.slice(0, i + 1).join("/");
      let child = cur.children.find(
        (c) => c.type === "dir" && c.path === p,
      ) as DirNode | undefined;
      if (!child) {
        child = { type: "dir", name: segs[i], path: p, children: [], count: 0 };
        cur.children.push(child);
      }
      cur = child;
    }
    cur.children.push({
      type: "file",
      name: segs[segs.length - 1],
      path: f.path,
      hits: f.hits,
      count: f.hits.length,
      baseGi: baseOffsets[fi] ?? 0,
    });
  });

  const count = (n: SearchTreeNode): number =>
    n.type === "file"
      ? n.count
      : (n.count = n.children.reduce((a, c) => a + count(c), 0));

  const collapse = (n: SearchTreeNode): SearchTreeNode => {
    if (n.type !== "dir") return n;
    n.children = n.children.map(collapse);
    while (n.children.length === 1 && n.children[0].type === "dir") {
      const only = n.children[0] as DirNode;
      n.name = n.name ? `${n.name}/${only.name}` : only.name;
      n.path = only.path;
      n.children = only.children;
    }
    return n;
  };

  root.children.forEach(count);
  return root.children.map(collapse);
}

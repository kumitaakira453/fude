// 開いているフォルダの中の道筋。すべてフォルダの根からの相対で持つ。

// 書かれた道筋を、根からの相対に直す。
//
// 頭が `/` なら**根から**解く。どこに貼っても同じ場所を指せる形が要る
// （塗のリンクを写すときに使う）。GitHub も `/` をリポジトリの根として読む。
export function resolvePath(baseDir: string, rel: string): string {
  const cleanRel = rel.split("#")[0].split("?")[0];
  const fromRoot = cleanRel.startsWith("/");
  const stack = !fromRoot && baseDir ? baseDir.split("/") : [];
  for (const seg of cleanRel.split("/")) {
    if (seg === "" || seg === ".") continue;
    // 根より上へは出ない。
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return stack.join("/");
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

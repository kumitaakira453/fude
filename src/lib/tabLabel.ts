// タブの名前に添える、親のフォルダ。
//
// 名前が重なるタブ（README.md が 2 つ、など）だけに、見分けがつくところまで
// 親のフォルダを後ろから足して返す。重ならなければ空。どれだけ深くても足すのは
// 見分けに要る段だけで、省いた前の部分は「…/」にする。

const split = (path: string): { name: string; dirs: string[] } => {
  const parts = path.split("/").filter(Boolean);
  return { name: parts.pop() ?? path, dirs: parts };
};

export function tabWhere(path: string, all: readonly string[]): string {
  const me = split(path);
  const same = all.filter((p) => p !== path && split(p).name === me.name).map((p) => split(p).dirs);
  if (same.length === 0) return "";
  for (let k = 1; k <= me.dirs.length; k++) {
    const tail = me.dirs.slice(-k).join("/");
    if (same.every((dirs) => dirs.slice(-k).join("/") !== tail)) {
      return (k < me.dirs.length ? "…/" : "") + tail;
    }
  }
  return me.dirs.join("/");
}

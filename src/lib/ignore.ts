// 一覧から外すもの。書き方は .gitignore と同じで、当てるのは Rust 側の走査。
// ここは設定画面が「いくつで外しているか」を出すために、効いている行を数える
// だけを持つ。書き方の解釈を 2 つ持つと、画面の数と実際の見え方がずれる。

// 空行と覚書（#）を落とす。行末の空白は、\ で逃がしていなければ無視される。
export function ignoreLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const row = /\\\s*$/.test(line) ? line : line.replace(/\s+$/, "");
    if (!row.trim() || row.startsWith("#")) continue;
    out.push(row);
  }
  return out;
}

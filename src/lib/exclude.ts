// 一覧から外す名前。設定で書いたものを、名前に当てる式へ組み直す。
//
// 書き方はしるし付き（glob）。`*` は任意の並び、`?` は 1 文字で、それ以外の字は
// そのままの意味になる。素の正規表現にしないのは、打っている途中の式がそのまま
// 壊れた式になるのと（`*.log` は正規表現として不正）、素直に書いた `.log` が
// 「任意の 1 文字 + log」として blog まで巻き込むため。
//
// 見るのはファイルの名前だけ。道筋は見ない。

// しるし以外は逃がす。書いた字がそのままの意味になる。
const escape = (text: string): string => text.replace(/[.+^${}()|[\]\\]/g, "\\$&");

function ruleOf(line: string): RegExp | null {
  const text = line.trim();
  if (!text || text.startsWith("#")) return null;
  // しるしを含むならそのまま当てる。
  if (/[*?]/.test(text)) {
    const glob = escape(text).replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${glob}$`, "i");
  }
  // 途中に点があるなら、名前そのもの（package-lock.json）。
  if (text.slice(1).includes(".")) return new RegExp(`^${escape(text)}$`, "i");
  // それ以外は拡張子の書き方（log / .log）。同じ名前のファイル（Makefile）にも
  // 当てたいので、点より前は無くてもよいことにする。
  return new RegExp(`^(.*\\.)?${escape(text.replace(/^\./, ""))}$`, "i");
}

export function excludeRules(text: string): RegExp[] {
  const out: RegExp[] = [];
  for (const line of text.split("\n")) {
    const rule = ruleOf(line);
    if (rule) out.push(rule);
  }
  return out;
}

export const isExcluded = (name: string, rules: RegExp[]): boolean =>
  rules.some((rule) => rule.test(name));

// 一覧に出すかどうかの判断に、外す分を重ねる。外すだけなので、元の判断で
// 出さないものが出ることはない。
export function withExcluded(
  show: (name: string) => boolean,
  text: string,
): (name: string) => boolean {
  const rules = excludeRules(text);
  if (rules.length === 0) return show;
  return (name) => show(name) && !isExcluded(name, rules);
}

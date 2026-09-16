import { known, tokens } from "./md/highlight";

// 原文をそのまま、色付きで行ごとに並べるための切り分け。
//
// 色の範囲は編集面と同じ `tokens` から取る。読むとき・書くとき・原文を見るとき
// で色の出どころを 1 つにしておくと、言語を足したときに食い違わない。

export interface Piece {
  text: string;
  // hljs-* の名前。色を付けないところは null。
  cls: string | null;
}

// これを超える大きさでは色を付けない。全文を歩くので、大きなファイルでは
// 待ち時間の方が目立つ。
const TOO_BIG = 300_000;

// 拡張子では引けないもの。hljs が別名として持っていない綴りだけを並べる。
const BY_NAME: Record<string, string> = {
  conf: "ini",
  cfg: "ini",
  env: "ini",
  mdx: "markdown",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  brewfile: "ruby",
};

// 名前から色付けの言語を決める。決まらなければ null（色無しで出す）。
//
// 拡張子をそのまま hljs に聞く。ts・yml・py といった綴りは向こうが別名として
// 持っているので、ほとんどはこれで当たる。拡張子の無い名前（Makefile など）は
// 名前そのもので引く。
export function langOf(nameOrPath: string): string | null {
  const name = (nameOrPath.split("/").pop() ?? nameOrPath).toLowerCase();
  // 点で始まる名前（.env）は拡張子を持たない。頭の点を落として名前で引く。
  const dot = name.lastIndexOf(".");
  const key = dot > 0 ? name.slice(dot + 1) : name.replace(/^\./, "");
  if (!key) return null;
  return known(key) ? key : (BY_NAME[key] ?? null);
}

export function paintLines(code: string, lang: string | null): Piece[][] {
  const marks = code.length > TOO_BIG ? [] : tokens(code, lang);
  const out: Piece[][] = [];
  let at = 0;
  let next = 0;

  for (const line of code.split("\n")) {
    const end = at + line.length;
    const pieces: Piece[] = [];
    let cut = at;
    // この行に掛かる範囲だけを見る。範囲は前から順に並んでいる。
    while (next < marks.length && marks[next].to <= at) next++;
    for (let i = next; i < marks.length && marks[i].from < end; i++) {
      const from = Math.max(marks[i].from, cut);
      const to = Math.min(marks[i].to, end);
      if (to <= from) continue;
      if (from > cut) pieces.push({ text: code.slice(cut, from), cls: null });
      pieces.push({ text: code.slice(from, to), cls: marks[i].cls });
      cut = to;
    }
    if (cut < end) pieces.push({ text: code.slice(cut, end), cls: null });
    out.push(pieces);
    at = end + 1;
  }
  return out;
}

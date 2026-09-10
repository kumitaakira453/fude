import { lcsPairs } from "./blockDiff";

// 文字単位の差分。書き換わった段落の、変わった字だけに印を付けるのに使う。
//
// 単語で区切らない日本語にそのまま効くよう、コードポイントで数える。返す位置は
// UTF-16 の添字（描画結果の文字位置と同じ数え方）なので、そのまま Range に
// できる。

export interface Span {
  from: number;
  to: number;
}

export interface CharDiff {
  del: Span[]; // 変更前から消えた区間（変更前の文字位置）
  ins: Span[]; // 変更後に入った区間（変更後の文字位置）
  // 長すぎて突き合わせを諦めたか。諦めたときは全体を 1 区間にする。
  gaveUp: boolean;
}

// 突き合わせの表は長さの積だけ場所を取る（2000 字どうしで 16MB）。
// 段落 1 つとしては十分に長いところで諦める。
export const CHAR_LIMIT = 1200;

export function charDiff(a: string, b: string): CharDiff {
  const left = codePoints(a);
  const right = codePoints(b);
  if (left.chars.length > CHAR_LIMIT || right.chars.length > CHAR_LIMIT) {
    return {
      del: a ? [{ from: 0, to: a.length }] : [],
      ins: b ? [{ from: 0, to: b.length }] : [],
      gaveUp: true,
    };
  }

  const del: Span[] = [];
  const ins: Span[] = [];
  let i = 0;
  let j = 0;
  const gap = (untilA: number, untilB: number) => {
    if (untilA > i) del.push({ from: left.at[i], to: left.at[untilA] });
    if (untilB > j) ins.push({ from: right.at[j], to: right.at[untilB] });
    i = untilA;
    j = untilB;
  };

  for (const [pa, pb] of lcsPairs(left.chars, right.chars)) {
    gap(pa, pb);
    i++;
    j++;
  }
  gap(left.chars.length, right.chars.length);

  return { del, ins, gaveUp: false };
}

// コードポイントごとに割り、それぞれが UTF-16 で何文字目から始まるかを持つ。
// サロゲートペアを割らずに数えつつ、位置は描画結果と同じ数え方で返せる。
function codePoints(text: string): { chars: string[]; at: number[] } {
  const chars: string[] = [];
  const at: number[] = [];
  let i = 0;
  for (const ch of text) {
    chars.push(ch);
    at.push(i);
    i += ch.length;
  }
  at.push(i);
  return { chars, at };
}

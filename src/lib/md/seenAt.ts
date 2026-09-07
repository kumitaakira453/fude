import type { Node as PmNode } from "prosemirror-model";
import type { Loaded } from "./fromMarkdown";

// 上端に見えているブロックを、原文の先頭からの文字数として控える。
//
// 読むときと同じ数え方にしておくので、通常モードへ戻ったときにそのまま
// 合わせ先として使える。
//
// 引くのは今の doc から。読み込んだときの位置で並べた控えを引くと、1 文字
// 打った時点で以降のブロックの位置が全部ずれて当たらなくなる。目印（id）は
// 打っても変わらないので、そこから原文の範囲を引く。
//
// 足したばかりのブロックは目印を持たない。手前へ寄って、目印のあるところを
// 控える（先頭へ落とすと「戻ってくると本文の頭に居る」になる）。

export interface Seen {
  // 原文の先頭からの文字数。
  at: number;
  // 控えたブロックの、doc の中での位置。入り込んだ画素を測る先。
  pos: number;
}

export function seenAt(doc: PmNode, loaded: Loaded, pos: number): Seen | null {
  if (doc.childCount === 0) return null;

  // その位置を含むブロック。本文の外なら端のブロックへ寄せる。
  let index = 0;
  let start = 0;
  let at = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const size = doc.child(i).nodeSize;
    index = i;
    start = at;
    if (pos < at + size) break;
    at += size;
  }

  for (let i = index; i >= 0; i--) {
    const id = doc.child(i).attrs.id as string | null;
    const range = id ? loaded.ranges.get(id) : undefined;
    if (range) return { at: range[0], pos: start };
    if (i > 0) start -= doc.child(i - 1).nodeSize;
  }
  return null;
}

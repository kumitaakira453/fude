import type { DecorationSet } from "prosemirror-view";

// 印を持ち回すための小道具。
//
// カーソルの居場所に印を付けるプラグインは、選択が変わるたびに呼ばれる。
// そこで毎回 DecorationSet を作り直すと、ProseMirror は中身が同じでも
// 「装飾が変わった」と見なし（比べるのは同一性）、その節点を描き直す。
// 範囲を引いている間は選択の変化が毎フレーム来るので、これが引っかかりに
// なる。行き先が前と同じなら前のものをそのまま返せるように、範囲を照らす。

// その集合が、ちょうどこの範囲だけを覆っているか。
export function covers(set: DecorationSet, from: number, to: number): boolean {
  const found = set.find();
  return found.length === 1 && found[0].from === from && found[0].to === to;
}

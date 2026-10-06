import type { MouseEvent } from "react";

// 選ぶ一覧の上で、マウスが本当に動いたか。
//
// WebView は、マウスが止まっていても下の要素が入れ替わっただけで mousemove を
// 送る（一覧を開いた瞬間・キー操作で一覧がスクロールしたとき）。それを動いた
// ことにすると、たまたまマウスの下に来た行へ当たりが引き戻され、キー操作で
// 選べなくなる。直前の位置を控えて、そこから動いたときだけ「動いた」とする。
// 一度動いたら入れ物に data-moved を立て、CSS の :hover の塗りもそこから効かせる。
export function movedIn(e: MouseEvent<HTMLElement>): boolean {
  const list = e.currentTarget.closest<HTMLElement>(".mg-pick-list");
  if (!list) return true;
  const at = `${e.screenX},${e.screenY}`;
  const was = list.dataset.at;
  list.dataset.at = at;
  if (was === undefined || was === at) return false;
  list.dataset.moved = "";
  return true;
}

// キー操作で当たりを動かした。マウスがまた動くまで、:hover の塗りを止める
// （止まったマウスの下の行と、キーの当たりの 2 行が塗られないように）。
export function keyedIn(list: HTMLElement | null | undefined): void {
  if (list) delete list.dataset.moved;
}

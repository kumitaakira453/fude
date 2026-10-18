// 開閉した行を、画面の同じ高さに残す。
//
// フォルダを閉じると下の行が減る。下のほうまで送っていると一覧が短くなって
// スクロールが下端へ引き戻され、押した行がずれる。上端に貼り付いた見出しを
// 閉じたときも、見出しが本来の位置へ戻ってずれる。どれを押したか分からなく
// なるので、押した行の高さを覚えておき、描き直した後でずれた分だけ送り戻す。
//
// 送り戻すのに一覧の長さが足りないときは、末尾の空き（slack）を伸ばして
// 送れる幅を作る。空きは見えている分だけ残し、上へ送ったら縮める。

// 行の、スクロールする箱から見た高さ。
export function rowTop(scroller: HTMLElement, row: HTMLElement): number {
  return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

// 行の今の高さを before に戻す。足りない分は slack を伸ばして作る。
export function holdRow(
  scroller: HTMLElement,
  row: HTMLElement,
  before: number,
  slack: HTMLElement,
): void {
  const moved = rowTop(scroller, row) - before;
  if (Math.abs(moved) < 0.5) return;
  const want = scroller.scrollTop + moved;
  const room = scroller.scrollHeight - scroller.clientHeight;
  if (want > room) {
    const now = parseFloat(slack.style.height) || 0;
    slack.style.height = `${now + (want - room)}px`;
  }
  scroller.scrollTop = Math.max(0, want);
}

// 空きを、見えている分だけに縮める。上へ送って見えなくなった分は要らない。
export function trimSlack(scroller: HTMLElement, slack: HTMLElement): void {
  const now = parseFloat(slack.style.height) || 0;
  if (now <= 0) return;
  const content = scroller.scrollHeight - now;
  const seen = scroller.scrollTop + scroller.clientHeight;
  const keep = Math.max(0, Math.min(now, seen - content));
  if (keep !== now) slack.style.height = `${keep}px`;
}

// 縦に送る箱。行の祖先をたどって、最初に縦の送りを持つものを返す。
export function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let at = el?.parentElement ?? null; at; at = at.parentElement) {
    const y = getComputedStyle(at).overflowY;
    if (y === "auto" || y === "scroll") return at;
  }
  return null;
}

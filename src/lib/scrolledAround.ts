// スクロールの合図が、el の位置を動かすものか。
//
// 捕まえる向き（capture）で window に張った scroll には、窓の中のどの要素の
// スクロールも届く（入力欄の中の横送りも）。el を含む箱か、文書全体（要素で
// ない target）のスクロールだけが el を動かす。
export function scrolledAround(target: EventTarget | null, el: Element): boolean {
  return !(target instanceof Element) || target.contains(el);
}

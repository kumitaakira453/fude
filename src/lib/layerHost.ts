import { useEffect, useState } from "react";

// つまみの層を置く入れ物。
//
// 層は本文の上に重ねるだけで、本文の中には入れない（ProseMirror は自分の DOM の
// 変化を見ていて、React が要素を差し込むとそれを本文の書き換えと取り違える）。
// ただし本文の入れ物そのものへ portal すると、その入れ物は React が描いている
// ので、ファイルを切り替えて消えるときに「親が先、層が後」の順になることがある。
// 後から親を探しても居ないので、そこで落ちる。
//
// 入れ物を自分で作って自分で外せば、React が持つのは中身だけになる。親が先に
// 消えても入れ物は生きているので、中身の片付けは空振りしない。
//
// 場所は取らない。層は position: absolute で親を基準に置くので、間に挟んでも
// 座標は変わらない。
export function useLayerHost(parent: HTMLElement | null): HTMLElement | null {
  const [box] = useState(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.top = "0";
    el.style.left = "0";
    el.dataset.mgLayer = "";
    return el;
  });

  useEffect(() => {
    if (!parent || !box) return;
    parent.appendChild(box);
    return () => {
      box.remove();
    };
  }, [parent, box]);

  return parent && box ? box : null;
}

// 本文を見張る MutationObserver の知らせのうち、本文そのものが変わったものが
// あるか。層は本文の入れ物の中に置いているので、印やつまみを描き直すだけでも
// 知らせが来る。それを拾って測り直すと、測り直しで描いた層がまた知らせを呼ぶ。
const inLayer = (node: Node | null): boolean => {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return !!el?.closest("[data-mg-layer]");
};

export function touchesBody(records: MutationRecord[]): boolean {
  return records.some((r) => {
    // 読む時点で外れている要素への知らせは数えない。本文から抜けたのなら、
    // 抜けたこと自体が別の知らせとして届く。
    if (!r.target.isConnected || inLayer(r.target)) return false;
    if (r.type !== "childList") return true;
    // 層の入れ物そのものの出し入れ（開いたとき・閉じたとき）も本文の変化ではない。
    const moved = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
    return moved.length === 0 || moved.some((n) => !inLayer(n));
  });
}

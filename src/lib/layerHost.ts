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

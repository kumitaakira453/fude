import { useEffect } from "react";

// 選択を引いているあいだ、body に印を付ける。本文に重ねたもの（指摘のカード・
// ブロックのつまみ・選択メニュー）を触れない板にするために使う。
// 引いている途中で押せるものが下に出ると、ドラッグの行き先をそれが奪って、
// 選択が本文の端まで飛ぶ。
export function useDragging() {
  useEffect(() => {
    const mark = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // 重ねたもの（つまみ・印・カード）を掴んだときは抑えない。抑えると
      // 押した瞬間に触れない板になり、つまみ自身のドラッグが始まらない。
      const el = e.target as Element | null;
      if (el?.closest?.(".mg-block-layer, .mg-review-layer, .mg-hl-layer")) {
        return;
      }
      document.body.classList.add("mg-dragging");
    };
    const clear = () => document.body.classList.remove("mg-dragging");
    window.addEventListener("mousedown", mark);
    window.addEventListener("mouseup", clear);
    // 窓の外で離したときにも外す。
    window.addEventListener("blur", clear);
    return () => {
      clear();
      window.removeEventListener("mousedown", mark);
      window.removeEventListener("mouseup", clear);
      window.removeEventListener("blur", clear);
    };
  }, []);
}

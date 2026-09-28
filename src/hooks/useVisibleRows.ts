import { useLayoutEffect, useState, type RefObject } from "react";

// 高さの揃った行の並びのうち、いま組む範囲 [start, end) を返す。
//
// 数万行を全部組むと、組み終わるまで待たされ、組んだ後もスクロールに描画が
// 追いつかない。見えている行とその前後だけを組み、見えていない分は高さだけの
// 空きで埋める（空きの高さは行の数 × rowH で出す）。
//
// anchor は行の並びを包む要素。スクロールするのは、その祖先のうち最も近い
// 「overflow が auto / scroll」の要素。lead は anchor の頭から最初の行までの
// 高さ（上の余白や固定した見出し）。
//
// 範囲はスクロールの催しの中で決める。次のフレームへ回すと、その 1 フレーム
// ぶん描画が遅れて空きが見える。

// 見えている範囲の前後に余分に組む行の数。速く送っても空きが見えないよう、
// 1 画面ぶん以上を持つ。組み直しは STEP 行動いたときだけにする。
const OVERSCAN = 60;
const STEP = 20;

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") return at;
  }
  return null;
}

export function useVisibleRows(
  anchor: RefObject<HTMLElement | null>,
  count: number,
  rowH: number,
  lead = 0,
): [number, number] {
  const [range, setRange] = useState<[number, number]>([0, Math.min(count, OVERSCAN * 2)]);
  useLayoutEffect(() => {
    const el = anchor.current;
    const sc = el && scrollParent(el);
    if (!el || !sc) {
      setRange([0, Math.min(count, OVERSCAN * 2)]);
      return;
    }
    const update = () => {
      const head = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      const top = Math.max(0, sc.scrollTop - head - lead);
      const first = Math.floor(top / rowH);
      const last = Math.ceil((top + sc.clientHeight) / rowH);
      const start = Math.min(count, Math.max(0, Math.floor((first - OVERSCAN) / STEP) * STEP));
      const end = Math.min(count, Math.ceil((last + OVERSCAN) / STEP) * STEP);
      setRange((was) => (was[0] === start && was[1] === end ? was : [start, end]));
    };
    update();
    sc.addEventListener("scroll", update, { passive: true });
    const seen = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    seen?.observe(sc);
    return () => {
      sc.removeEventListener("scroll", update);
      seen?.disconnect();
    };
  }, [anchor, count, rowH, lead]);
  return range;
}

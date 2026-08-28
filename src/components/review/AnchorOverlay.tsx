import { useCallback, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { headOf, type Resolution } from "../../lib/blockDiff";
import { readBlockText, rangeAt } from "../../lib/domText";
import { findPlain } from "../../lib/projection";
import type { AnchorHit, ReviewThread } from "../../lib/review";

// 指摘が付いている箇所に印を重ねる。DOM は書き換えず、矩形を絶対配置で
// 載せるだけなので本文の組版に影響しない。
//
// 位置は「基準版のブロック → 対応付け → 現在のブロック」で決める。現在の本文から
// 引用文字列を探すと、指摘に応えて本文が書き換えられた瞬間に位置を失う。

interface Mark {
  id: string;
  moved: boolean; // 対象が書き換わっている
  rects: { top: number; left: number; width: number; height: number }[];
  hit: AnchorHit;
}

export function AnchorOverlay({
  content,
  threads,
  resolutions,
  contentKey,
  onPick,
}: {
  content: HTMLElement | null;
  threads: ReviewThread[];
  resolutions: Map<string, Resolution>;
  contentKey: string;
  onPick: (hit: AnchorHit) => void;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);

  const compute = useCallback(() => {
    if (!content || threads.length === 0) {
      setMarks([]);
      return;
    }
    const base = content.getBoundingClientRect();
    const next: Mark[] = [];

    for (const thread of threads) {
      const resolution = resolutions.get(thread.id);
      const head = resolution ? headOf(resolution) : null;
      if (!resolution || !head) continue; // 削除された / 対象が分からない

      const el = content.querySelector<HTMLElement>(`[data-mg-block="${head.index}"]`);
      if (!el) continue; // 漸進描画でまだ出ていない

      const bt = readBlockText(el);
      // 書き換わっている場合は文字単位の対応が取れないため、ブロック全体に印を付ける
      const span =
        resolution.state === "unchanged" && thread.selection
          ? findPlain(bt.plain, thread.selection, thread.selection_offset)
          : null;
      const range = span
        ? rangeAt(bt, span.start, span.end)
        : rangeAt(bt, 0, bt.plain.length);
      if (!range) continue;

      const rects = Array.from(range.getClientRects());
      if (rects.length === 0) continue;

      next.push({
        id: thread.id,
        moved: resolution.state === "rewritten",
        rects: rects.map((rc) => ({
          top: rc.top - base.top,
          left: rc.left - base.left,
          width: rc.width,
          height: rc.height,
        })),
        hit: {
          id: thread.id,
          top: rects[0].top,
          bottom: rects[rects.length - 1].bottom,
          left: rects[0].left,
        },
      });
    }
    setMarks(next);
  }, [content, threads, resolutions]);

  // 漸進描画で後から出るブロックにも追従する。
  useLayoutEffect(() => {
    compute();
    if (!content) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(content);
    const mo = new MutationObserver(schedule);
    mo.observe(content, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [compute, content, contentKey]);

  if (!content || marks.length === 0) return null;

  return createPortal(
    <div className="mg-review-layer not-prose">
      {marks.map((mark) =>
        mark.rects.map((rc, i) => (
          <button
            key={`${mark.id}:${i}`}
            type="button"
            title={mark.moved ? "指摘のあと書き換わった箇所" : "この指摘を開く"}
            onClick={() => onPick(mark.hit)}
            className={`mg-review-mark${mark.moved ? " mg-review-mark-moved" : ""}`}
            style={{ top: rc.top, left: rc.left, width: rc.width, height: rc.height }}
          />
        )),
      )}
    </div>,
    content,
  );
}

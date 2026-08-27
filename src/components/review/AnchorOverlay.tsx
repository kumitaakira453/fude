import { useCallback, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Block } from "../../lib/blocks";
import { readBlockText, rangeAt } from "../../lib/domText";
import { findPlain } from "../../lib/projection";
import type { AnchorHit, ReviewThread } from "../../lib/review";

// 指摘が付いている箇所に印を重ねる。DOM は書き換えず、矩形を絶対配置で
// 載せるだけなので本文の組版に影響しない。

interface Mark {
  id: string;
  rects: { top: number; left: number; width: number; height: number }[];
  hit: AnchorHit;
}

export function AnchorOverlay({
  content,
  threads,
  blocks,
  contentKey,
  onPick,
}: {
  content: HTMLElement | null;
  threads: ReviewThread[];
  blocks: Block[];
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
      // 指摘した時点のブロック本文がそのまま残っているブロックを探す
      const block = blocks.find((b) => b.src === thread.quote);
      if (!block) continue;
      const el = content.querySelector<HTMLElement>(`[data-mg-block="${block.index}"]`);
      if (!el) continue; // 漸進描画でまだ出ていない

      const bt = readBlockText(el);
      const span = thread.selection
        ? findPlain(bt.plain, thread.selection, thread.selection_offset)
        : { start: 0, end: bt.plain.length };
      if (!span) continue;

      const range = rangeAt(bt, span.start, span.end);
      if (!range) continue;
      const rects = Array.from(range.getClientRects());
      if (rects.length === 0) continue;

      next.push({
        id: thread.id,
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
  }, [content, threads, blocks]);

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
            title="この指摘を開く"
            onClick={() => onPick(mark.hit)}
            className="mg-review-mark"
            style={{ top: rc.top, left: rc.left, width: rc.width, height: rc.height }}
          />
        )),
      )}
    </div>,
    content,
  );
}

import { useMemo, useState } from "react";
import { buildProjection, findPlain, findPlainLoose } from "../../lib/projection";

// 指摘を付けた時点の本文と、その中で選ばれていた部分。
//
// 選ばれた文字列だけを出すと、語の途中から始まって何の話か読み取れない。
// 当時のブロック全体を平文に均し、選ばれた部分の前後を切り出して見せる。

// 選択の前後に添える文字数。前を短く、後ろを長く取ると、読み始めの語が
// 途中から始まらずに済む。
const BEFORE = 60;
const AFTER = 200;

interface Passage {
  text: string;
  hit: { start: number; end: number } | null;
}

function passageOf(quote: string, selection: string, offset: number): Passage {
  const { plain } = buildProjection(quote);
  const text = plain.trim().length > 0 ? plain : quote;
  const needle = selection.trim();
  if (!needle) return { text, hit: null };
  // 記録された位置が今も合っていればそれを使い、ずれていれば探し直す
  if (text.slice(offset, offset + needle.length) === needle) {
    return { text, hit: { start: offset, end: offset + needle.length } };
  }
  return { text, hit: findPlain(text, needle, offset) ?? findPlainLoose(text, needle) };
}

export function Quote({
  quote,
  selection,
  offset,
}: {
  quote: string;
  selection: string;
  offset: number;
}) {
  const [open, setOpen] = useState(false);
  const { text, hit } = useMemo(
    () => passageOf(quote, selection, offset),
    [quote, selection, offset],
  );

  const from = open || !hit ? 0 : Math.max(0, hit.start - BEFORE);
  const to = open || !hit ? text.length : Math.min(text.length, hit.end + AFTER);
  const trimmed = to - from < text.length;

  const head = text.slice(from, hit ? hit.start : to);
  const tail = hit ? text.slice(hit.end, to) : "";

  return (
    <div className="mg-quote-wrap">
      <blockquote className={`mg-quote${open ? " is-open" : ""}`}>
        {from > 0 && <span className="mg-quote-cut">…</span>}
        {head}
        {hit && <mark className="mg-quote-hit">{text.slice(hit.start, hit.end)}</mark>}
        {tail}
        {to < text.length && <span className="mg-quote-cut">…</span>}
      </blockquote>
      {(trimmed || open) && (
        <button className="mg-quote-more" onClick={() => setOpen((v) => !v)}>
          {open ? "前後だけ表示" : `当時の全文を見る（${text.length} 字）`}
        </button>
      )}
    </div>
  );
}

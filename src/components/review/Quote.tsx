import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readBlockText, rangeAt } from "../../lib/domText";
import { findPlain, findPlainLoose } from "../../lib/projection";
import { Markdown } from "../Markdown";

// 指摘を付けた時点の本文と、その中で選ばれていた部分。
//
// 当時の書き方のまま描いて、選ばれていた部分にだけ印を付ける。字の並びへ
// 均すと、表では区切りが消え、箇条書きでは行頭の印が消えて、何への指摘なのか
// 読み取れない。周りも見えているほうが、指摘の意味が分かる。

// 印の名前。描画側は ::highlight() で拾う。現在の本文に付ける印
// （DocumentView）と同時に出るので、別の名前にする。
const MARK = "mg-quote-selection";

export function Quote({
  quote,
  selection,
  offset,
}: {
  quote: string;
  selection: string;
  offset: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // 折りたたんだ高さに収まりきらないか。収まるなら開く操作は出さない。
  const [over, setOver] = useState(false);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setOver(box.scrollHeight > box.clientHeight + 4);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [quote, open]);

  // 選ばれていた部分に印を付ける。DOM は書き換えず、範囲だけを描画側へ渡す。
  useEffect(() => {
    const registry = "highlights" in CSS ? CSS.highlights : null;
    const box = boxRef.current;
    if (!registry) return;
    registry.delete(MARK);
    const needle = selection.trim();
    if (!box || !needle) return;
    const text = readBlockText(box);
    const hit =
      findPlain(text.plain, needle, offset) ??
      findPlainLoose(text.plain, needle);
    if (!hit) return;
    const range = rangeAt(text, hit.start, hit.end);
    if (!range) return;
    registry.set(MARK, new Highlight(range));
    // 印が折りたたんだ枠の外にあると、関係のない所だけを見せることになる。
    const spot = range.startContainer.parentElement;
    if (spot) {
      const a = spot.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (a.top < b.top || a.bottom > b.bottom) {
        box.scrollTop += a.top - b.top - 12;
      }
    }
    return () => {
      registry.delete(MARK);
    };
  }, [quote, selection, offset, open]);

  return (
    <div className="mg-quote-wrap">
      <div
        ref={boxRef}
        className={`mg-quote-md mg-prose prose${open ? " is-open" : ""}`}
      >
        <Markdown body={quote} editorial={false} />
      </div>
      {(over || open) && (
        <button className="mg-quote-more" onClick={() => setOpen((v) => !v)}>
          {open ? "折りたたむ" : "全部見る"}
        </button>
      )}
    </div>
  );
}

import { useMemo, useRef } from "react";
import { useVisibleRows } from "../hooks/useVisibleRows";
import { paintLines, type Piece } from "../lib/code";
import { fontVar, widestText } from "../lib/textWidth";

// 原文を、色を付けたまま一面に出す。
//
// 読むときの囲み（コードの塊）と同じ見た目にすると、書き物の中に貼られた
// 引用のように見える。ここで見せたいのはファイルそのものなので、縁を作らず
// 端まで敷いて、行番号を添える。
//
// 組むのは見えている行とその前後だけ（useVisibleRows）。行の高さは CSS で
// LINE px に揃え、見えていない分は高さだけの空きで埋める。横幅は最初に全体の
// 最も長い行から決めて固定する（組む行が入れ替わるたびに横幅が変わらない）。

// 行の高さ（px）。index.css の .mg-source と対にする。
const LINE = 21;
// 上の余白（.mg-source の padding-top、0.6rem）。
const TOP = 10;
// 行番号の欄（3.2rem）と間（1rem）と右の余白（1.5rem）。
const GUTTER = 92;

export function SourceView({
  code,
  lang,
  painted,
}: {
  code: string;
  lang: string | null;
  // 色分けを済ませた行（CSV の列の色など）。渡したら言語での色付けはしない。
  painted?: Piece[][];
}) {
  // 色の切り分けは全文に対して行う。行で切ってから色を付けると、複数行に
  // またがる囲みやコメントの色が途中で切れる。
  const lines = useMemo(() => painted ?? paintLines(code, lang), [painted, code, lang]);
  const box = useRef<HTMLDivElement>(null);
  const [start, end] = useVisibleRows(box, lines.length, LINE, TOP);
  const width = useMemo(() => {
    const texts = lines.map((l) => l.map((p) => p.text).join("").replace(/\t/g, "  "));
    const font = `12.5px ${fontVar("--mg-font-mono", "monospace")}`;
    return Math.ceil(widestText(texts, font)) + GUTTER;
  }, [lines]);

  return (
    <div
      ref={box}
      className="mg-source"
      // 行番号は数え上げで描くので、組み始めの行から数え直す。
      style={{ minWidth: `max(100%, ${width}px)`, counterReset: `mg-line ${start}` }}
    >
      {start > 0 && <div style={{ height: start * LINE }} />}
      {lines.slice(start, end).map((pieces, n) => (
        <div key={start + n} className="mg-source-line">
          {/* 番号は CSS の数え上げで描く（SourceView は中身を持たない）。 */}
          <span className="mg-source-no" />
          <code>
            {pieces.map((piece, i) =>
              piece.cls ? (
                <span key={i} className={piece.cls}>
                  {piece.text}
                </span>
              ) : (
                piece.text
              ),
            )}
          </code>
        </div>
      ))}
      {end < lines.length && <div style={{ height: (lines.length - end) * LINE }} />}
    </div>
  );
}

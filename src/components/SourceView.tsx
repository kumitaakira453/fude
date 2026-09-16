import { useEffect, useMemo, useState } from "react";
import { paintLines } from "../lib/code";

// 原文を、色を付けたまま一面に出す。
//
// 読むときの囲み（コードの塊）と同じ見た目にすると、書き物の中に貼られた
// 引用のように見える。ここで見せたいのはファイルそのものなので、縁を作らず
// 端まで敷いて、行番号を添える。

// 一度に組む行の数。数万行のファイルを一息に組むと、出るまで固まる。
// 最初の一画面ぶんを先に出し、あとは 1 フレームずつ伸ばす。
const FIRST = 200;
const NEXT = 2_000;

export function SourceView({ code, lang }: { code: string; lang: string | null }) {
  // 色の切り分けは全文に対して行う。行で切ってから色を付けると、複数行に
  // またがる囲みやコメントの色が途中で切れる。
  const lines = useMemo(() => paintLines(code, lang), [code, lang]);
  const [limit, setLimit] = useState(FIRST);

  useEffect(() => setLimit(FIRST), [lines]);
  useEffect(() => {
    if (limit >= lines.length) return;
    const frame = requestAnimationFrame(() => setLimit((n) => n + NEXT));
    return () => cancelAnimationFrame(frame);
  }, [limit, lines.length]);

  return (
    <div className="mg-source">
      {lines.slice(0, limit).map((pieces, n) => (
        <div key={n} className="mg-source-line">
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
    </div>
  );
}

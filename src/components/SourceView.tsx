import { useMemo } from "react";
import { paintLines } from "../lib/code";

// 原文を、色を付けたまま一面に出す。
//
// 読むときの囲み（コードの塊）と同じ見た目にすると、書き物の中に貼られた
// 引用のように見える。ここで見せたいのはファイルそのものなので、縁を作らず
// 端まで敷いて、行番号を添える。

export function SourceView({ code, lang }: { code: string; lang: string | null }) {
  const lines = useMemo(() => paintLines(code, lang), [code, lang]);
  return (
    <div className="mg-source">
      {lines.map((pieces, n) => (
        <div key={n} className="mg-source-line">
          <span className="mg-source-no">{n + 1}</span>
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

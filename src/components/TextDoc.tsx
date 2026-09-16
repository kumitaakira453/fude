import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { langOf } from "../lib/code";
import { readText } from "../lib/fsAccess";
import { assetVersionAtom } from "../state/atoms";
import { SourceView } from "./SourceView";

// 字で書かれたファイルを、そのまま読む。
//
// 書き換えはしない。Markdown 以外は読む面だけを出す（編集は doc の側が持つ）。
//
// 拡張子から言語を決めて色を付ける。決まらなければ色無しで、字はそのまま出す。

export function TextDoc({ abs }: { abs: string }) {
  const version = useAtomValue(assetVersionAtom);
  const [text, setText] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const lang = useMemo(() => langOf(abs), [abs]);

  useEffect(() => {
    let alive = true;
    setText(null);
    setLost(false);
    void readText(abs).then(
      (read) => alive && setText(read),
      // 名前で除ききれなかった中身（字にならないもの）はここで止まる。
      () => alive && setLost(true),
    );
    return () => {
      alive = false;
    };
  }, [abs, version]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {lost ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--mg-muted)]">
            このファイルは字として読めませんでした
          </div>
        ) : (
          text !== null && <SourceView code={text} lang={lang} />
        )}
      </div>
      <div className="mg-imgdoc-bar">
        <span className="mg-imgdoc-size">{lost ? "" : (lang ?? "文字")}</span>
      </div>
    </div>
  );
}

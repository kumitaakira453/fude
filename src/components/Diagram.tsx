import { useAtomValue } from "jotai";
import { useRef, useState } from "react";
import { useDiagramSvg } from "../hooks/useDiagramSvg";
import { DARK_THEME_IDS } from "../lib/themes";
import { themeAtom } from "../state/atoms";
import { D2, describeDiagramError } from "../lib/diagram";
import { Icon } from "./Icon";
import { MermaidModal } from "./MermaidModal";

// 図（mermaid・d2）。lang はコードの塊の言語名。
export function Diagram({ lang, code }: { lang: string; code: string }) {
  const theme = useAtomValue(themeAtom);
  // 図の見た目は暗テーマ / 明テーマの 2 種類しかないため、同じ明暗の
  // テーマ間を移動しただけでは描き直さない（テーマ切替が重くなるのを防ぐ）。
  const dark = DARK_THEME_IDS.has(theme);
  const { svg, error } = useDiagramSvg(lang, code, dark);
  const [zoomed, setZoomed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // 失敗時（記述途中含む）はコードとエラー内容を表示して UI を壊さない。
  if (error) {
    const { title, where, text } = describeDiagramError(lang, error);
    return (
      <div className="my-4 overflow-x-auto rounded-lg border border-[var(--mg-danger)]/40 bg-[var(--mg-code-bg)] p-3">
        <div className="mg-mermaid-err-head mb-2">
          <Icon name="error" size={14} />
          <span>{title}</span>
          {where && <span className="mg-mermaid-err-at">{where}</span>}
        </div>
        <pre className="mb-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--mg-danger)]">
          {text}
        </pre>
        <pre className="text-xs leading-relaxed text-[var(--mg-muted)]">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (!svg) return null;

  // 図はテーマに合わせて描画済み（暗テーマ=明線 / 明テーマ=暗線）。カードは敷かず、
  // モーダルの固定オーバーレイをテーマに合わせて線が沈まないようにする。

  return (
    <>
      <div
        ref={ref}
        className="mg-mermaid my-4"
        // 書き出しで別の明暗に描き直すときの元の記述
        data-mermaid={code.trim()}
        data-lang={lang}
        role="button"
        // d2 の図は、ノードの注釈（title）を出すので、外側の吹き出しを重ねない。
        title={lang === D2 ? undefined : "クリックで拡大"}
        onClick={(e) => {
          e.stopPropagation();
          setZoomed(true);
        }}
      >
        {/* 図の SVG（mermaid は securityLevel: strict、d2 は cleanSvg で消毒済み） */}
        <div
          className="mg-mermaid-inner"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <span className="mg-mermaid-zoom" aria-hidden>
          <Icon name="zoom_out_map" size={15} />
        </span>
      </div>
      {zoomed && (
        <MermaidModal
          svg={svg}
          dark={dark}
          onClose={() => setZoomed(false)}
        />
      )}
    </>
  );
}

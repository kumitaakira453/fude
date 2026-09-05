import { useAtomValue } from "jotai";
import { useContext, useRef, useState } from "react";
import { useMermaidSvg } from "../hooks/useMermaidSvg";
import { DARK_THEME_IDS } from "../lib/themes";
import { themeAtom } from "../state/atoms";
import { Icon } from "./Icon";
import { markdownContext } from "./MarkdownContext";
import { MermaidModal } from "./MermaidModal";

export function Mermaid({ code }: { code: string }) {
  const theme = useAtomValue(themeAtom);
  // 図の見た目は暗テーマ / 明テーマの 2 種類しかないため、同じ明暗の
  // テーマ間を移動しただけでは描き直さない（テーマ切替が重くなるのを防ぐ）。
  const dark = DARK_THEME_IDS.has(theme);
  const { svg, error } = useMermaidSvg(code, dark);
  const [zoomed, setZoomed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ctx = useContext(markdownContext);

  // 直すのはブロック単位なので、この図がどのブロックかを DOM から辿って頼む。
  const edit = ctx?.onEditBlock;
  const editThis = () => {
    const at =
      ref.current?.closest<HTMLElement>("[data-mg-block]")?.dataset.mgBlock;
    if (at === undefined || !edit) return;
    setZoomed(false);
    edit(Number(at));
  };

  // 失敗時（記述途中含む）はコードとエラー内容を表示して UI を壊さない。
  if (error) {
    return (
      <div className="my-4 overflow-x-auto rounded-lg border border-[var(--mg-danger)]/40 bg-[var(--mg-code-bg)] p-3">
        <div className="mb-2 text-xs font-medium text-[var(--mg-danger)]">
          mermaid エラー
        </div>
        <pre className="mb-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--mg-danger)]">
          {error}
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
        role="button"
        title="クリックで拡大"
        onClick={(e) => {
          e.stopPropagation();
          setZoomed(true);
        }}
        // ブロックのダブルクリック編集（コード表示）を抑止
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {/* mermaid が生成する SVG（securityLevel: strict でサニタイズ済み） */}
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
          onEdit={edit ? editThis : undefined}
          onClose={() => setZoomed(false)}
        />
      )}
    </>
  );
}

import type { CSSProperties } from "react";
import { uiGlyph } from "../lib/uiIcons";

// 絵。名前は Material Symbols の名前で指す。
//
// 画面の周りの絵は Tabler の線画で描く（対応は lib/uiIcons）。本文の中に描く絵
// （注記の印など）は content を付け、Material Symbols の字形のまま出す。
// フォントは material-symbols パッケージからバンドルされ、CDN 非依存。
export function Icon({
  name,
  size = 20,
  fill = false,
  weight = 400,
  grade = 0,
  className = "",
  style,
  content = false,
  stroke = 1.6,
}: {
  name: string;
  size?: number;
  fill?: boolean;
  weight?: number;
  grade?: number;
  className?: string;
  style?: CSSProperties;
  content?: boolean;
  // 線画の線の太さ。小さい絵ほど太めにすると、同じ濃さに見える。
  stroke?: number;
}) {
  const glyph = content ? null : uiGlyph(name, fill);
  if (glyph) {
    return (
      <span
        className={`mg-ui-icon inline-flex shrink-0 items-center justify-center leading-none ${className}`}
        style={{ width: size, height: size, ...style }}
        data-icon={name}
        aria-hidden
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={glyph.solid ? "currentColor" : "none"}
          stroke={glyph.solid ? "none" : "currentColor"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: glyph.inner }}
        />
      </span>
    );
  }
  return (
    <span
      className={`material-symbols-rounded select-none leading-none ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${size}`,
        ...style,
      }}
      data-icon={name}
      aria-hidden
    >
      {name}
    </span>
  );
}

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
}: {
  name: string;
  size?: number;
  fill?: boolean;
  weight?: number;
  grade?: number;
  className?: string;
  style?: CSSProperties;
  content?: boolean;
}) {
  const glyph = content ? null : uiGlyph(name, fill);
  if (glyph) {
    // 線画は字形より一回り大きく見えるので、少しだけ小さく描く。
    const px = Math.round(size * 0.84);
    return (
      <span
        className={`mg-ui-icon inline-flex shrink-0 items-center justify-center leading-none ${className}`}
        style={{ width: size, height: size, ...style }}
        data-icon={name}
        aria-hidden
      >
        <svg
          width={px}
          height={px}
          viewBox="0 0 24 24"
          fill={glyph.solid ? "currentColor" : "none"}
          stroke={glyph.solid ? "none" : "currentColor"}
          strokeWidth={1.6}
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

import type { CSSProperties } from "react";

// Google Material Symbols (Rounded) を使うアイコン。
// フォントは material-symbols パッケージからバンドルされ、CDN 非依存。
export function Icon({
  name,
  size = 20,
  fill = false,
  weight = 400,
  grade = 0,
  className = "",
  style,
}: {
  name: string;
  size?: number;
  fill?: boolean;
  weight?: number;
  grade?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`material-symbols-rounded select-none leading-none ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${size}`,
        ...style,
      }}
      aria-hidden
    >
      {name}
    </span>
  );
}

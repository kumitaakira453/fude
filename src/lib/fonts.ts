export interface FontDef {
  id: string;
  label: string;
  stack: string;
}

// 本文の書体。日本語グリフを含むスタックを用意する。
export const FONTS: FontDef[] = [
  {
    id: "sans",
    label: "ゴシック",
    stack:
      'system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif',
  },
  {
    id: "serif",
    label: "明朝",
    stack:
      '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", "Songti SC", Georgia, serif',
  },
  {
    id: "anthropic-serif",
    label: "Anthropic Serif",
    // Anthropic のブランドセリフ。実フォント未所持環境では上質なセリフへフォールバック。
    stack:
      '"Copernicus", "Tiempos Text", "Tiempos", "ff-tisa-web-pro", "Noto Serif JP", "Hiragino Mincho ProN", Georgia, serif',
  },
  {
    id: "rounded",
    label: "丸ゴシック",
    stack:
      '"Hiragino Maru Gothic ProN", "Hiragino Maru Gothic Pro", "Rounded Mplus 1c", "Zen Maru Gothic", "Quicksand", system-ui, sans-serif',
  },
  {
    id: "humanist",
    label: "ヒューマニスト",
    stack:
      '"Avenir Next", "Segoe UI", "Optima", "Hiragino Sans", "Noto Sans JP", sans-serif',
  },
  {
    id: "mono",
    label: "等幅",
    stack:
      'ui-monospace, "SF Mono", "JetBrains Mono", "Source Han Code JP", "Noto Sans Mono CJK JP", "BIZ UDGothic", Menlo, monospace',
  },
];

export const FONT_MAP: Record<string, string> = Object.fromEntries(
  FONTS.map((f) => [f.id, f.stack]),
);

export function fontStack(id: string): string {
  return FONT_MAP[id] ?? FONT_MAP.sans;
}

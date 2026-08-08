export interface ThemeDef {
  id: string;
  label: string;
  emoji: string;
  dark: boolean;
}

// data-theme 属性で index.css の CSS 変数を切り替える。
export const THEMES: ThemeDef[] = [
  { id: "aurora", label: "Aurora", emoji: "🌌", dark: true },
  { id: "midnight", label: "Midnight", emoji: "🌙", dark: true },
  { id: "nord", label: "Nord", emoji: "🧊", dark: true },
  { id: "forest", label: "Forest", emoji: "🌲", dark: true },
  { id: "dracula", label: "Dracula", emoji: "🧛", dark: true },
  { id: "tokyonight", label: "Tokyo Night", emoji: "🌃", dark: true },
  { id: "catppuccin", label: "Catppuccin", emoji: "🐱", dark: true },
  { id: "rosepine", label: "Rosé Pine", emoji: "🪻", dark: true },
  { id: "paper", label: "Paper", emoji: "📜", dark: false },
  { id: "sunset", label: "Sunset", emoji: "🌅", dark: false },
  { id: "rose", label: "Rosé", emoji: "🌸", dark: false },
  { id: "solarized", label: "Solarized", emoji: "☀️", dark: false },
];

// 暗色テーマ ID（Mermaid のテーマ切替などで使用）
export const DARK_THEME_IDS = new Set(
  THEMES.filter((t) => t.dark).map((t) => t.id),
);

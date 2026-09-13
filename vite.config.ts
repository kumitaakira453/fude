import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri と連携するための固定ポート。mermaid は手動チャンク分割で初期ロードを軽く保つ。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      // remark / micromark は devlop の「開発用」を引くと、内部の前提が崩れた
      // ところで例外を投げる。人の書いた Markdown でも崩れることがあり
      // （空の項目の次の行が "[ ] " で始まると、タスクの印の親が listItem に
      // ならない）、読み手のアプリがそれで落ちるのは筋が違う。本番と同じ
      // 「何もしない」方を dev でも引く。
      devlop: fileURLToPath(new URL("./node_modules/devlop/lib/default.js", import.meta.url)),
    },
  },
  server: {
    port: 5273,
    strictPort: true,
    watch: {
      // dev 時、プロジェクト配下のフォルダを開いて md/画像を移動・編集しても
      // Vite が全ページリロードしないよう、ドキュメント/画像を監視対象から除外。
      // （本番=tauri build では Vite 自体が無いので無関係）
      ignored: [
        "**/*.md",
        "**/*.markdown",
        "**/*.mdx",
        "**/*.mdown",
        "**/*.mkd",
        "**/*.png",
        "**/*.jpg",
        "**/*.jpeg",
        "**/*.gif",
        "**/*.webp",
        "**/*.bmp",
        "**/*.avif",
        "**/sample/**",
      ],
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          mermaid: ["mermaid"],
          katex: ["katex", "rehype-katex", "remark-math"],
          hljs: ["highlight.js", "rehype-highlight"],
        },
      },
    },
  },
});

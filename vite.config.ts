import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri と連携するための固定ポート。mermaid は手動チャンク分割で初期ロードを軽く保つ。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5273,
    strictPort: true,
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

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// mermaid はサイズが大きいので手動チャンク分割し、初期ロードを軽く保つ
export default defineConfig({
  plugins: [react(), tailwindcss()],
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

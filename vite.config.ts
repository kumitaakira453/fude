import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// pdf.js が開いた PDF に応じて取りに来るもの（文字の対応表・標準の書体・画像の
// 復号器・色の定義）。pdfjs/ の下に置き、dev では同じ道筋で返す。
const PDFJS_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];

function pdfjsAssets(): Plugin {
  const root = fileURLToPath(new URL("./node_modules/pdfjs-dist/", import.meta.url));
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
        const file = path.join(root, rel);
        if (!PDFJS_DIRS.includes(rel.split("/")[0]) || !file.startsWith(root)) return next();
        try {
          res.end(readFileSync(file));
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const dir of PDFJS_DIRS) {
        for (const name of readdirSync(path.join(root, dir))) {
          this.emitFile({
            type: "asset",
            fileName: `pdfjs/${dir}/${name}`,
            source: readFileSync(path.join(root, dir, name)),
          });
        }
      }
    },
  };
}

// Tauri と連携するための固定ポート。mermaid は手動チャンク分割で初期ロードを軽く保つ。
export default defineConfig({
  plugins: [react(), tailwindcss(), pdfjsAssets()],
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
  test: {
    setupFiles: ["./src/setupTests.ts"],
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

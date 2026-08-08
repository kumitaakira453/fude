import { useEffect, useId, useState } from "react";
import { useAtomValue } from "jotai";
import { themeAtom } from "../state/atoms";
import { DARK_THEME_IDS } from "../lib/themes";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

// フォントを inherit にすると mermaid が文字幅を測定できず巨大 SVG を吐くことがあるため、
// 実在するフォントスタックを指定する。
const MERMAID_FONT =
  'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif';

async function getMermaid(dark: boolean) {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  const mermaid = await mermaidPromise;
  mermaid.initialize({
    startOnLoad: false,
    theme: dark ? "dark" : "default",
    securityLevel: "strict",
    fontFamily: MERMAID_FONT,
    // 不正な図でエラー用の巨大グラフィックを DOM に注入させない（自前でフォールバック表示）
    suppressErrorRendering: true,
    maxTextSize: 90000,
  });
  return mermaid;
}

// mermaid が測定用に <body> へ挿入する一時要素を確実に除去する。
function cleanupOrphans(id: string) {
  document.getElementById(id)?.remove();
  document.getElementById(`d${id}`)?.remove();
}

export function Mermaid({ code }: { code: string }) {
  const theme = useAtomValue(themeAtom);
  const rawId = useId();
  const id = `mmd-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const trimmed = code.trim();
    if (!trimmed) {
      setSvg("");
      setError(false);
      return;
    }
    const dark = DARK_THEME_IDS.has(theme);
    getMermaid(dark)
      .then((mermaid) => mermaid.parse(trimmed).then(() => mermaid.render(id, trimmed)))
      .then(({ svg }) => {
        if (alive) {
          setSvg(svg);
          setError(false);
        }
        cleanupOrphans(id);
      })
      .catch(() => {
        if (alive) setError(true);
        cleanupOrphans(id);
      });
    return () => {
      alive = false;
      cleanupOrphans(id);
    };
  }, [code, theme, id]);

  // 失敗時（記述途中含む）はコードをそのまま表示して UI を壊さない。
  if (error) {
    return (
      <div className="my-4 overflow-x-auto rounded-lg border border-[var(--mg-border)] bg-[var(--mg-code-bg)] p-3">
        <div className="mb-2 text-xs font-medium text-[var(--mg-muted)]">mermaid（描画待ち）</div>
        <pre className="text-xs leading-relaxed text-[var(--mg-muted)]">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (!svg) return null;

  return (
    <div
      className="mg-mermaid my-4"
      // mermaid が生成する SVG を挿入（securityLevel: strict でサニタイズ済み）
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

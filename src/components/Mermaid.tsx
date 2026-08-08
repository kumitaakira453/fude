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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const trimmed = code.trim();
    if (!trimmed) {
      setSvg("");
      setError(null);
      return;
    }
    const dark = DARK_THEME_IDS.has(theme);
    getMermaid(dark)
      .then((mermaid) => mermaid.parse(trimmed).then(() => mermaid.render(id, trimmed)))
      .then(({ svg }) => {
        if (alive) {
          setSvg(svg);
          setError(null);
        }
        cleanupOrphans(id);
      })
      .catch((e) => {
        // WebKit(WKWebView) では draw 成功後の addA11yInfo で例外が出ることがあるが、
        // その時点で描画済み SVG は DOM(#<id>) に残っているので回収して使う。
        const drawn = document.getElementById(id);
        if (drawn && drawn.tagName.toLowerCase() === "svg") {
          if (alive) {
            setSvg(drawn.outerHTML);
            setError(null);
          }
        } else {
          console.error("[mdglow mermaid]", e);
          if (alive) setError(String(e?.message || e));
        }
        cleanupOrphans(id);
      });
    return () => {
      alive = false;
      cleanupOrphans(id);
    };
  }, [code, theme, id]);

  // 失敗時（記述途中含む）はコードとエラー内容を表示して UI を壊さない。
  if (error) {
    return (
      <div className="my-4 overflow-x-auto rounded-lg border border-[var(--mg-danger)]/40 bg-[var(--mg-code-bg)] p-3">
        <div className="mb-2 text-xs font-medium text-[var(--mg-danger)]">mermaid エラー</div>
        <pre className="mb-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--mg-danger)]">
          {error}
        </pre>
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

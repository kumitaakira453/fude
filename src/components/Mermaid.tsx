import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { DARK_THEME_IDS } from "../lib/themes";
import { themeAtom } from "../state/atoms";
import { Icon } from "./Icon";
import { MermaidModal } from "./MermaidModal";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
// render 用 id は effect ごとにユニークにする（StrictMode の二重実行で id が衝突し、
// 片方の cleanup がもう片方の描画済み SVG を消してしまうのを防ぐ）
let mermaidSeq = 0;

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
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let alive = true;
    const trimmed = code.trim();
    if (!trimmed) {
      setSvg("");
      setError(null);
      return;
    }
    // effect ごとにユニークな id（StrictMode 二重実行での cleanup 衝突回避）
    const id = `mmd-${mermaidSeq++}`;
    const dark = DARK_THEME_IDS.has(theme);
    getMermaid(dark)
      .then((mermaid) =>
        mermaid.parse(trimmed).then(() => mermaid.render(id, trimmed)),
      )
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
  }, [code, theme]);

  // 失敗時（記述途中含む）はコードとエラー内容を表示して UI を壊さない。
  if (error) {
    return (
      <div className="my-4 overflow-x-auto rounded-lg border border-[var(--mg-danger)]/40 bg-[var(--mg-code-bg)] p-3">
        <div className="mb-2 text-xs font-medium text-[var(--mg-danger)]">
          mermaid エラー
        </div>
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
    <>
      <div
        className="mg-mermaid my-4"
        role="button"
        title="クリックで拡大"
        onClick={() => setZoomed(true)}
      >
        {/* mermaid が生成する SVG（securityLevel: strict でサニタイズ済み） */}
        <div
          className="mg-mermaid-inner"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <span className="mg-mermaid-zoom" aria-hidden>
          <Icon name="zoom_out_map" size={15} />
        </span>
      </div>
      {zoomed && <MermaidModal svg={svg} onClose={() => setZoomed(false)} />}
    </>
  );
}

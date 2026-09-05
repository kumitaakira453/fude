// mermaid の読み込みと描画。図の見た目は暗テーマ / 明テーマの 2 種類しかないので、
// 初期化はそのどちらかで行う。

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
// 描画用の id は毎回ユニークにする（StrictMode の二重実行で id が衝突すると、
// 片方の片付けがもう片方の描画済み SVG を消してしまう）。
let seq = 0;

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

// 図を SVG 文字列にする。書きかけで構文が通らないときは例外を投げる。
export async function renderMermaid(
  code: string,
  dark: boolean,
): Promise<string> {
  const id = `mmd-${seq++}`;
  try {
    const mermaid = await getMermaid(dark);
    await mermaid.parse(code);
    const { svg } = await mermaid.render(id, code);
    return svg;
  } catch (e) {
    // WKWebView では描画に成功した後の addA11yInfo で例外が出ることがある。
    // その時点の SVG は DOM(#<id>) に残っているので回収して使う。
    const drawn = document.getElementById(id);
    if (drawn && drawn.tagName.toLowerCase() === "svg") return drawn.outerHTML;
    throw e;
  } finally {
    cleanupOrphans(id);
  }
}

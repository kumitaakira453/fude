// 読む面の見た目を、そのまま渡せる 1 枚の HTML にする。
//
// 原文から組み直さず、**生きている面を写す**。メイクアップ版は CSS だけでなく
// 組む DOM 自体が変わる（リンクカード・コールアウト・段組みの数字）ので、
// 組み直すと「見たまま」から外れる。
//
// 渡した先で通信が要らないこと、押せないものが残っていないことが要件。

export interface Look {
  title: string;
  theme: string;
  font: string;
  // 幅の長い表の手当て。渡した先でも先頭の列を置いていく。
  wide: boolean;
}

// 読む面に出る絵。同梱の書体は 5.3MB あり、合字で描いているので書体が無いと
// 「check_box_outline_blank」のような英単語が本文に出る。使う分だけ形で持つ。
const GLYPH: Record<string, string> = {
  info: "M12 2a10 10 0 110 20 10 10 0 010-20zm-1.2 8.4h2.4V17h-2.4zM12 6.3a1.3 1.3 0 100 2.7 1.3 1.3 0 000-2.7z",
  lightbulb:
    "M12 2.6A6.2 6.2 0 008.4 13.8V16h7.2v-2.2A6.2 6.2 0 0012 2.6zM8.8 17.4h6.4v1.5H8.8zm1 2.7h4.4v1.3H9.8z",
  priority_high:
    "M10.8 3.6h2.4v9.6h-2.4zM12 15.9a1.6 1.6 0 110 3.2 1.6 1.6 0 010-3.2z",
  warning:
    "M12 2.8 1.4 21.2h21.2zm-1.2 6.6h2.4v5.6h-2.4zm0 7.2h2.4v2.2h-2.4z",
  report:
    "M8.3 2h7.4L21 7.3v7.4L15.7 20H8.3L3 14.7V7.3zm2.5 4.4v6.4h2.4V6.4zm0 8.2v2.4h2.4v-2.4z",
  check_box:
    "M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm5.1 14.3 8-8-1.7-1.7-6.3 6.3-2.5-2.5-1.7 1.7z",
  check_box_outline_blank:
    "M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm0 2v14h14V5z",
  link: "M8.6 7H11v2H8.6a3 3 0 000 6H11v2H8.6a5 5 0 010-10zm4.4 0h2.4a5 5 0 010 10H13v-2h2.4a3 3 0 000-6H13zM8 11h8v2H8z",
  // 図の右上に出る「拡げる」の印。渡した先でも押せるので形を持たせる。
  zoom_out_map:
    "M14 4h6v6h-2V7.4l-3.3 3.3-1.4-1.4L16.6 6H14zm-4 0v2H7.4l3.3 3.3-1.4 1.4L6 7.4V10H4V4zm4.7 9.3 1.4-1.4 3.3 3.3V14h2v6h-6v-2h2.6zM9.3 11.9l1.4 1.4L7.4 16.6H10v2H4v-6h2v2.6z",
};

// 押せるもの・編集のための目印を落とす。渡した先で動かないものを残すと壊れて見える。
const DROP = [
  ".mg-block-layer", // 掴んで運ぶつまみ（React の外で article に足されている）
  ".mg-review-layer", // 指摘の印。渡す 1 枚には入れない
  ".mg-hl-layer", // 検索の当たりを塗る層
  ".mg-sel", // 編集面が自前で描く選択の帯
  ".mg-caret", // 同じく棒
  ".mg-cells", // 表のセルの選択
  ".mg-codeblock button", // 「コピー」
  ".mg-table-zoom", // 表を大きく開くつまみ
  ".ProseMirror-gapcursor", // 塊のあいだに出る棒
];

// 編集面が状態として付ける名前。写した先では意味を持たないのに、枠を描く。
const EDIT_STATES = ["ProseMirror-selectednode", "ProseMirror-focused", "is-focused"];

// 編集面の名残。付いたままだと、渡した先で読み手が困る指定まで効く
// （.mg-pm ::selection は帯を透明にする。自前で描く帯は渡す 1 枚には無い）。
const EDIT_CLASSES = ["mg-pm", "ProseMirror", "ProseMirror-focused"];
const EDIT_MARKS = [
  "translate",
  "role",
  "tabindex",
  "aria-multiline",
  "aria-label",
  "autocorrect",
  "autocapitalize",
];

const MARKS = [
  "data-mg-block",
  "data-mg-item",
  "data-mg-cell",
  "contenteditable",
  "spellcheck",
];

export function tidy(article: HTMLElement): HTMLElement {
  const out = article.cloneNode(true) as HTMLElement;
  for (const sel of DROP) out.querySelectorAll(sel).forEach((el) => el.remove());
  // 均す相手には**自分自身も入れる**。querySelectorAll は根を返さないので、
  // 中だけ見ていると、根に付いた contenteditable や編集面の名前が残る
  // （渡した先で書ける面になり、押すと枠が出る）。
  for (const el of [out, ...out.querySelectorAll<HTMLElement>("*")]) {
    el.classList.remove(...EDIT_CLASSES, ...EDIT_STATES);
    for (const name of [...MARKS, ...EDIT_MARKS]) el.removeAttribute(name);
  }
  // 図だけは渡した先でも拡げられるようにする（frame が小さな手を添える）。
  // 押せる目印は上の掃除で落ちているので、ここで付け直す。
  out.querySelectorAll(".mg-mermaid").forEach((el) => {
    el.setAttribute("role", "button");
    el.setAttribute("title", "クリックで拡大");
  });
  swapGlyphs(out);
  cutDeadLinks(out);
  return out;
}

function swapGlyphs(root: HTMLElement): void {
  root.querySelectorAll(".material-symbols-rounded").forEach((el) => {
    const path = GLYPH[(el.textContent ?? "").trim()];
    const size = Number.parseFloat((el as HTMLElement).style.fontSize) || 20;
    if (!path) {
      el.remove();
      return;
    }
    const svg = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    svg.style.verticalAlign = "middle";
    const d = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
    d.setAttribute("d", path);
    d.setAttribute("fill-rule", "evenodd");
    svg.appendChild(d);
    el.replaceWith(svg);
  });
}

// 渡した先で辿れない行き先は、字だけ残す。押しても何も起きないリンクを渡さない。
const LIVES = /^(#|https?:|mailto:)/i;

function cutDeadLinks(root: HTMLElement): void {
  root.querySelectorAll("a[href]").forEach((el) => {
    const href = el.getAttribute("href") ?? "";
    if (LIVES.test(href)) {
      if (href.startsWith("http")) el.setAttribute("target", "_blank");
      return;
    }
    el.replaceWith(...Array.from(el.childNodes));
  });
}

// 本文の画像はその場限りの blob。渡す 1 枚に焼き付ける。
export async function bakeImages(root: HTMLElement): Promise<void> {
  const shots = Array.from(root.querySelectorAll("img")).filter((el) =>
    /^blob:/.test(el.getAttribute("src") ?? ""),
  );
  await Promise.all(
    shots.map(async (el) => {
      const baked = await asDataUrl(el.getAttribute("src") ?? "");
      if (baked) el.setAttribute("src", baked);
      else el.replaceWith(missing(root, el.getAttribute("alt") ?? ""));
    }),
  );
}

function missing(root: HTMLElement, alt: string): HTMLElement {
  const el = root.ownerDocument.createElement("span");
  el.className = "mg-img-missing";
  el.textContent = alt || "画像を読めませんでした";
  return el;
}

async function asDataUrl(url: string): Promise<string | null> {
  try {
    const held = await fetch(url).then((r) => r.blob());
    return await new Promise<string>((ok, ng) => {
      const reader = new FileReader();
      reader.onload = () => ok(String(reader.result));
      reader.onerror = () => ng(reader.error);
      reader.readAsDataURL(held);
    });
  } catch {
    return null;
  }
}

// ---- 見た目 ----

// 段（@layer / @media / @supports）は中を選り分けてから積み直す。Tailwind v4 は
// すべてを @layer で包むので、上から文字列で弾くと丸ごと落ちる。
function isGroup(rule: CSSRule): boolean {
  const it = rule as CSSRule & { cssRules?: CSSRuleList; selectorText?: string };
  return !!it.cssRules && it.selectorText === undefined;
}

function wanted(text: string, math: boolean): boolean {
  if (!/@font-face/i.test(text)) return true;
  // 絵は形に差し替えたので、その書体は要らない（5.3MB）。
  if (/material-symbols/i.test(text)) return false;
  if (/katex/i.test(text)) return math;
  // 外から引く書体は渡した先で落ちる。
  return !/url\(/i.test(text) || /url\(\s*["']?data:/i.test(text);
}

function ruleText(rule: CSSRule, math: boolean): string {
  if (!isGroup(rule)) return wanted(rule.cssText, math) ? rule.cssText : "";
  const inner = Array.from((rule as CSSGroupingRule).cssRules)
    .map((r) => ruleText(r, math))
    .filter(Boolean)
    .join("\n");
  if (!inner) return "";
  const head = rule.cssText.slice(0, rule.cssText.indexOf("{") + 1);
  return `${head}\n${inner}\n}`;
}

export function gatherCss(sheets: Iterable<CSSStyleSheet>, math: boolean): string {
  const out: string[] = [];
  for (const sheet of sheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 別の出所の面は読めない
    }
    for (const rule of Array.from(rules)) {
      const text = ruleText(rule, math);
      if (text) out.push(text);
    }
  }
  return out.join("\n");
}

// 積んだ規則の中に残った外部の書体を焼き付ける（数式のときの KaTeX）。
export async function bakeFonts(css: string): Promise<string> {
  const urls = [...new Set(Array.from(css.matchAll(/url\(\s*["']?(\/[^)"']+)["']?\s*\)/gi), (m) => m[1]))];
  const baked = await Promise.all(urls.map((u) => asDataUrl(u)));
  let out = css;
  urls.forEach((url, at) => {
    const data = baked[at];
    if (data) out = out.split(url).join(data);
  });
  return out;
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 図を拡げて見る手。渡した先でやることは読むことなので、これだけを添える。
// 中身は写した SVG で、通信も外の道具も要らない。
const ZOOM_SCRIPT = [
  "(function () {",
  "  var open = function (svg) {",
  "    var box = document.createElement('div');",
  "    box.className = 'mg-zoombox';",
  "    var stage = document.createElement('div');",
  "    stage.className = 'mg-zoombox-stage';",
  "    stage.appendChild(svg.cloneNode(true));",
  "    box.appendChild(stage);",
  "    var k = 1, x = 0, y = 0, held = null, moved = false;",
  "    var put = function () {",
  "      stage.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')';",
  "    };",
  "    var close = function () {",
  "      box.remove();",
  "      window.removeEventListener('keydown', onKey);",
  "      window.removeEventListener('mousemove', onMove);",
  "      window.removeEventListener('mouseup', onUp);",
  "    };",
  "    var onKey = function (e) { if (e.key === 'Escape') close(); };",
  "    var onMove = function (e) {",
  "      if (!held) return;",
  "      moved = true;",
  "      x = e.clientX - held.x;",
  "      y = e.clientY - held.y;",
  "      put();",
  "    };",
  "    var onUp = function () { held = null; };",
  "    box.addEventListener('wheel', function (e) {",
  "      e.preventDefault();",
  "      k = Math.min(8, Math.max(0.3, k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));",
  "      put();",
  "    }, { passive: false });",
  "    box.addEventListener('mousedown', function (e) {",
  "      moved = false;",
  "      held = { x: e.clientX - x, y: e.clientY - y };",
  "    });",
  "    box.addEventListener('click', function () { if (!moved) close(); });",
  "    window.addEventListener('keydown', onKey);",
  "    window.addEventListener('mousemove', onMove);",
  "    window.addEventListener('mouseup', onUp);",
  "    document.body.appendChild(box);",
  "  };",
  "  var all = document.querySelectorAll('.mg-mermaid');",
  "  for (var i = 0; i < all.length; i++) {",
  "    (function (el) {",
  "      el.addEventListener('click', function () {",
  "        var svg = el.querySelector('svg');",
  "        if (svg) open(svg);",
  "      });",
  "    })(all[i]);",
  "  }",
  "})();",
].join("\n");

// 渡す 1 枚の枠。テーマと書体は html に載っているので、そこを写し取る。
export function frame(body: string, css: string, look: Look): string {
  return `<!doctype html>
<html lang="ja" data-theme="${escape(look.theme)}" data-font="${escape(look.font)}" data-widetable="${look.wide ? "on" : "off"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(look.title)}</title>
<style>
${css}
</style>
<style>
body { margin: 0; background: var(--mg-bg); color: var(--mg-fg); }
.mg-sheet { padding: 3rem 1.5rem 5rem; }
/* 渡した先ですることは読むことと写すこと。アプリの側には掴んで運ぶための
   「選ばせない」指定があるので、ここで選べる側に戻す。 */
.mg-sheet, .mg-sheet * {
  -webkit-user-select: text;
  user-select: text;
  cursor: auto;
}
.mg-sheet a { cursor: pointer; }
/* 図は押すと拡がる。読むだけの 1 枚で、唯一動くところ。 */
.mg-sheet .mg-mermaid { cursor: zoom-in; }
.mg-zoombox {
  position: fixed;
  z-index: 100;
  display: grid;
  inset: 0;
  place-items: center;
  background: rgb(0 0 0 / 72%);
  cursor: zoom-out;
  overflow: hidden;
}
.mg-zoombox-stage { transform-origin: center; }
.mg-zoombox svg { max-width: 92vw; max-height: 88vh; height: auto; }
</style>
</head>
<body>
<div class="mg-sheet">
${body}
</div>
<script>
${ZOOM_SCRIPT}
</script>
</body>
</html>
`;
}

// 一息入れて、画面に描く番を渡す。続けて走らせると、出したばかりの
// 「書き出しています…」が描かれないまま固まって見える。
const breathe = (): Promise<void> =>
  new Promise((ok) => {
    requestAnimationFrame(() => setTimeout(ok, 0));
  });

export async function makeHandout(article: HTMLElement, look: Look): Promise<string> {
  await breathe();
  const out = tidy(article);
  await bakeImages(out);
  await breathe();
  const math = !!out.querySelector(".katex");
  const css = await bakeFonts(gatherCss(article.ownerDocument.styleSheets, math));
  await breathe();
  return frame(out.outerHTML, css, look);
}

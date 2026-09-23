// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bakeImages, frame, gatherCss, tidy } from "./handout";

// 渡す 1 枚に均す処理。押せるものが残っていないか、渡した先で切れるものを
// 抱えていないかを見る。

function article(html: string): HTMLElement {
  const el = document.createElement("article");
  el.className = "mg-prose prose mg-editorial";
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

// 規則の当て木。段（@layer）は中を持ち、選り分けてから積み直す作りを写す。
function rule(cssText: string, inner?: unknown[]): CSSRule {
  return { cssText, ...(inner ? { cssRules: inner } : {}) } as unknown as CSSRule;
}
function sheet(rules: CSSRule[]): CSSStyleSheet {
  return { cssRules: rules } as unknown as CSSStyleSheet;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("均す", () => {
  it("掴むつまみと押せる釦を落とす", () => {
    const out = tidy(
      article(`
        <div class="mg-block-layer"><button>つまみ</button></div>
        <div class="mg-review-layer"><span>指摘</span></div>
        <div class="mg-hl-layer"></div>
        <div class="mg-codeblock"><button>コピー</button><pre>x</pre></div>
        <div class="mg-mermaid" role="button" title="クリックで拡大">
          <svg></svg><span class="mg-mermaid-zoom">z</span>
        </div>`),
    );
    expect(out.querySelector(".mg-block-layer")).toBeNull();
    // 指摘と検索の当たりは渡す 1 枚に入れない。
    expect(out.querySelector(".mg-review-layer")).toBeNull();
    expect(out.querySelector(".mg-hl-layer")).toBeNull();
    expect(out.querySelector(".mg-codeblock button")).toBeNull();
    expect(out.querySelector(".mg-mermaid-zoom")).toBeNull();
    expect(out.querySelector(".mg-mermaid")?.hasAttribute("role")).toBe(false);
    // 図そのものは残る。
    expect(out.querySelector(".mg-mermaid svg")).not.toBeNull();
  });

  it("編集の目印を落とし、済みの印とトグルの開閉は残す", () => {
    const out = tidy(
      article(`
        <div class="mg-block" data-mg-block="0" contenteditable="true">
          <li data-mg-item="1" data-checked="true">済み</li>
        </div>
        <details open><summary>畳み</summary><p>中</p></details>`),
    );
    expect(out.querySelector("[data-mg-block]")).toBeNull();
    expect(out.querySelector("[data-mg-item]")).toBeNull();
    expect(out.querySelector("[contenteditable]")).toBeNull();
    expect(out.querySelector("li")?.getAttribute("data-checked")).toBe("true");
    expect(out.querySelector("details")?.hasAttribute("open")).toBe(true);
  });

  it("合字の絵を形に差し替える", () => {
    const out = tidy(
      article(
        `<span class="mg-task-check"><span class="material-symbols-rounded" style="font-size: 20px">check_box</span></span>`,
      ),
    );
    expect(out.querySelector(".material-symbols-rounded")).toBeNull();
    const svg = out.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M5 3h14/);
    // 押せる見かけの入れ物は残ってよい（印そのもの）。
    expect(out.querySelector(".mg-task-check")).not.toBeNull();
  });

  it("知らない絵は落とす（英単語を本文に残さない）", () => {
    const out = tidy(
      article(`<span class="material-symbols-rounded">zoom_out_map</span>`),
    );
    expect(out.textContent).not.toContain("zoom_out_map");
  });

  it("辿れないリンクは字だけにする", () => {
    const out = tidy(
      article(`
        <a href="./別の.md">別の</a>
        <a href="#節">節へ</a>
        <a href="https://example.com">外</a>`),
    );
    expect(out.querySelectorAll("a")).toHaveLength(2);
    expect(out.textContent).toContain("別の");
    expect(out.querySelector('a[href="#節"]')).not.toBeNull();
    expect(out.querySelector('a[href^="https"]')?.getAttribute("target")).toBe("_blank");
  });
});

describe("画像を焼き付ける", () => {
  it("blob は data に、読めないものは印だけ残す", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      url.includes("良")
        ? Promise.resolve({ blob: () => Promise.resolve(new Blob(["絵"])) })
        : Promise.reject(new Error("読めない")),
    );
    const el = article(
      `<img src="blob:tauri://良" alt="良い"><img src="blob:tauri://悪" alt="悪い"><img src="https://example.com/x.png">`,
    );
    await bakeImages(el);
    const shots = el.querySelectorAll("img");
    expect(shots[0].getAttribute("src")).toMatch(/^data:/);
    // 外を指すものは触らない。
    expect(shots[1].getAttribute("src")).toBe("https://example.com/x.png");
    expect(el.querySelector(".mg-img-missing")?.textContent).toBe("悪い");
  });
});

describe("見た目を積む", () => {
  const sheets = () => [
    sheet([
      rule("@layer base {...}", [
        rule(".mg-prose { color: red; }"),
        rule('@font-face { font-family: "Material Symbols Rounded"; src: url(/a.woff2); }'),
        rule('@font-face { font-family: "KaTeX_Main"; src: url(/k.woff2); }'),
      ]),
      rule(".mg-callout { display: flex; }"),
    ]),
  ];

  it("絵の書体は積まない（形に差し替えてあるので要らない）", () => {
    const css = gatherCss(sheets(), true);
    expect(css).not.toContain("Material Symbols");
    expect(css).toContain(".mg-prose");
    expect(css).toContain(".mg-callout");
  });

  it("数式が無ければ KaTeX の書体も積まない", () => {
    expect(gatherCss(sheets(), false)).not.toContain("KaTeX_Main");
    expect(gatherCss(sheets(), true)).toContain("KaTeX_Main");
  });

  it("段は中を選り分けたうえで、段のまま積み直す", () => {
    const css = gatherCss(sheets(), false);
    expect(css).toContain("@layer base {");
    expect(css.match(/}/g)?.length).toBeGreaterThan(1);
  });
});

describe("枠", () => {
  it("テーマと書体を写し、地色を敷く", () => {
    const html = frame("<article>本文</article>", ".mg-prose{}", {
      title: "覚え書き",
      theme: "midnight",
      font: "mincho",
    });
    expect(html).toContain('<html lang="ja" data-theme="midnight" data-font="mincho">');
    expect(html).toContain("<title>覚え書き</title>");
    expect(html).toContain("background: var(--mg-bg)");
    expect(html).toContain("<article>本文</article>");
  });

  it("渡した先で字を選べる", () => {
    const html = frame("", "", { title: "x", theme: "daylight", font: "sans" });
    expect(html).toContain("user-select: text");
  });

  it("題の中の記号を逃がす", () => {
    expect(frame("", "", { title: "<script>", theme: "daylight", font: "sans" })).toContain(
      "<title>&lt;script&gt;</title>",
    );
  });
});

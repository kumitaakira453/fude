// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Markdown } from "../components/Markdown";
import { d2DiagramAtom } from "../state/atoms";
import { cleanSvg, describeDiagramError, isDiagramLang, renderDiagram } from "./diagram";

// d2 の図（ベータ）。描くのは Rust 側の render_d2 なので、ここでは呼び先を差し替える。

const asked: { code: string; dark: boolean }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { code: string; dark: boolean }) => {
    if (cmd !== "render_d2") throw new Error(`知らない呼び出し: ${cmd}`);
    asked.push(args);
    if (args.code.includes("->  ")) throw "connection missing destination";
    return '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>x()</script><text>図</text></svg>';
  },
  convertFileSrc: (p: string) => p,
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("図にする言語", () => {
  it("mermaid はいつも、d2 は設定が入のときだけ", () => {
    expect(isDiagramLang("mermaid", false)).toBe(true);
    expect(isDiagramLang("d2", false)).toBe(false);
    expect(isDiagramLang("d2", true)).toBe(true);
    expect(isDiagramLang("ts", true)).toBe(false);
  });
});

describe("図のエラーの見せ方", () => {
  it("d2 のコードエラーは、題と行・桁と中身に分ける", () => {
    expect(describeDiagramError("d2", "1:1: connection missing destination")).toEqual({
      title: "コードエラー",
      where: "1 行目 1 文字目",
      text: "connection missing destination",
    });
  });

  it("d2 が無い・時間切れはコードエラーと言わない", () => {
    expect(describeDiagramError("d2", "d2 コマンドが見つかりません").title).toBe("d2 で描けません");
    expect(describeDiagramError("d2", "d2 が 10 秒で終わりませんでした").title).toBe("d2 で描けません");
  });

  it("mermaid の文はそのまま中身にする", () => {
    expect(describeDiagramError("mermaid", "Parse error on line 2")).toEqual({
      title: "コードエラー",
      where: "",
      text: "Parse error on line 2",
    });
  });
});

describe("d2 の図", () => {
  it("描いた SVG から script と on* の属性を落とす", () => {
    const svg = cleanSvg('<svg xmlns="http://www.w3.org/2000/svg" onclick="a()"><script>a()</script><g onmouseover="b()"/></svg>');
    expect(svg).not.toContain("script");
    expect(svg).not.toMatch(/on(click|mouseover)/);
    expect(svg).toContain("<g");
  });

  it("元の大きさを持たせ、真ん中に寄せる", () => {
    const svg = cleanSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 303 285" preserveAspectRatio="xMinYMin meet"><g/></svg>');
    expect(svg).toContain('width="303"');
    expect(svg).toContain('height="285"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("d2 が敷く白い下地は外し、ほかの rect は残す", () => {
    const svg = cleanSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 87 266"><svg class="d2-1 d2-svg">' +
        '<rect x="-17" y="-17" width="87" height="266" fill="#FFFFFF" class=" fill-N7"/>' +
        '<g><rect class="shape fill-B6" width="10" height="10"/></g></svg></svg>',
    );
    expect(svg).not.toContain("fill-N7");
    expect(svg).toContain("fill-B6");
  });

  it("同じ記述・同じ明暗は、2 度目はコマンドを呼ばない", async () => {
    asked.length = 0;
    await renderDiagram("d2", "a -> b", false);
    await renderDiagram("d2", "a -> b", false);
    await renderDiagram("d2", "a -> b", true);
    expect(asked).toEqual([
      { code: "a -> b", dark: false },
      { code: "a -> b", dark: true },
    ]);
  });

  it("描けないときは d2 のエラーの文をそのまま投げる", async () => {
    await expect(renderDiagram("d2", "a ->  ", false)).rejects.toBe("connection missing destination");
  });
});

describe("本文の d2 のコードの塊", () => {
  const show = (on: boolean) => {
    const store = createStore();
    store.set(d2DiagramAtom, on);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <Provider store={store}>
          <Markdown body={"```d2\nx -> y\n```\n"} editorial />
        </Provider>,
      ),
    );
    return host;
  };

  it("設定が切なら、ふつうのコードの塊として出す", () => {
    const el = show(false);
    expect(el.querySelector(".mg-mermaid")).toBeNull();
    expect(el.textContent).toContain("x -> y");
  });

  it("設定が入なら図として描く", async () => {
    const el = show(true);
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 0));
    });
    const fig = el.querySelector<HTMLElement>(".mg-mermaid");
    expect(fig?.dataset.lang).toBe("d2");
    expect(fig?.querySelector("svg")).not.toBeNull();
    expect(fig?.innerHTML).not.toContain("script");
  });
});

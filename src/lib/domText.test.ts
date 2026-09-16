// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { rangeAt, readFlowText } from "./domText";

// 組み上がった本文を 1 本の文字列として読む。強調やリンクで割れた文字ノードを
// 繋ぐのが役目で、塊の境目だけは繋がない。

const host = (html: string): HTMLElement => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe("readFlowText", () => {
  it("強調で割れた文字ノードを繋ぐ", () => {
    const el = host("<p>このファイルは<strong>mdglow</strong>の表示機能</p>");
    expect(readFlowText(el).plain).toBe("このファイルはmdglowの表示機能");
  });

  it("リンクやコードも同じ 1 本になる", () => {
    const el = host('<p>まず<a href="/x">入口</a>から<code>fude</code>を開く</p>');
    expect(readFlowText(el).plain).toBe("まず入口からfudeを開く");
  });

  it("塊の境目には改行が入る", () => {
    const el = host("<p>前の段落</p><p>次の段落</p>");
    expect(readFlowText(el).plain).toBe("前の段落\n次の段落");
  });

  it("表のセルも塊として分かれる", () => {
    const el = host("<table><tr><td>権限</td><td>閲覧者</td></tr></table>");
    expect(readFlowText(el).plain).toBe("権限\n閲覧者");
  });

  it("画面に出るがソースには無い字は読まない", () => {
    const el = host(
      '<p>開く<span class="material-symbols-rounded">drag_indicator</span></p>',
    );
    expect(readFlowText(el).plain).toBe("開く");
  });

  it("飾りをまたぐ範囲が、もとの文字ノードを指す", () => {
    const el = host("<p>このファイルは<strong>mdglow</strong>の表示機能</p>");
    const flow = readFlowText(el);
    const at = flow.plain.indexOf("はmd");
    const range = rangeAt(flow, at, at + 3);
    expect(range?.toString()).toBe("はmd");
  });
});

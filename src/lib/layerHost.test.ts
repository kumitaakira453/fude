// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { touchesBody } from "./layerHost";

// 本文を見張る知らせのうち、層の中だけの変化は本文の変化として数えない。
// 数えると、測り直しで描いた層がまた測り直しを呼ぶ。

function watch(run: (body: HTMLElement, layer: HTMLElement) => void): Promise<{ n: number; body: boolean }> {
  const body = document.createElement("article");
  const p = document.createElement("p");
  p.textContent = "本文";
  body.appendChild(p);
  const layer = document.createElement("div");
  layer.dataset.mgLayer = "";
  document.body.appendChild(body);
  return new Promise((done) => {
    const seen: MutationRecord[] = [];
    const mo = new MutationObserver((records) => seen.push(...records));
    mo.observe(body, { childList: true, subtree: true, characterData: true });
    run(body, layer);
    queueMicrotask(() => {
      seen.push(...mo.takeRecords());
      mo.disconnect();
      const result = { n: seen.length, body: touchesBody(seen) };
      body.remove();
      done(result);
    });
  });
}

describe("touchesBody", () => {
  it("層の入れ物の出し入れと、層の中の描き直しは数えない", async () => {
    const records = await watch((body, layer) => {
      body.appendChild(layer);
      const mark = document.createElement("div");
      layer.appendChild(mark);
      mark.textContent = "印";
      layer.removeChild(mark);
      layer.remove();
    });
    expect(records.n).toBeGreaterThan(0);
    expect(records.body).toBe(false);
  });

  it("本文の変化は数える", async () => {
    const records = await watch((body) => {
      body.appendChild(document.createElement("p"));
    });
    expect(records.body).toBe(true);
  });

  it("本文の字の書き換えも数える", async () => {
    const records = await watch((body) => {
      (body.querySelector("p")!.firstChild as Text).data = "書き換え";
    });
    expect(records.body).toBe(true);
  });
});

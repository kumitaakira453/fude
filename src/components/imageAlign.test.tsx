// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";
import { markdownContext } from "./MarkdownContext";

// 読む面の画像の寄せと幅。原文の `<p align><img width></p>` をそのまま描く。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

const ctx = {
  docPath: "a.md",
  onNavigate: () => {},
  resolveAsset: () => Promise.resolve("blob:図"),
  peekAsset: () => "blob:図",
};

function render(body: string): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <markdownContext.Provider value={ctx}>
        <Markdown body={body} editorial />
      </markdownContext.Provider>,
    ),
  );
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("読む面の画像の寄せと幅", () => {
  it("<p align> の寄せを目印に移す", () => {
    const at = render('<p align="right"><img src="./images/a.png" width="40%"></p>');
    expect(at.querySelector("p")?.dataset.align).toBe("right");
    expect(at.querySelector<HTMLImageElement>("img")?.style.width).toBe("40%");
  });

  it("キャプションがあれば、幅は包みに当てる", () => {
    const at = render('<p align="left"><img src="./images/a.png" alt="図" width="320"></p>');
    expect(at.querySelector<HTMLElement>(".mg-figure")?.style.width).toBe("320px");
    expect(at.querySelector<HTMLImageElement>("img")?.style.width).toBe("100%");
  });

  it("寄せも幅も無い画像は今までどおり", () => {
    const at = render("![図](./images/a.png)");
    expect(at.querySelector("p")?.dataset.align).toBeUndefined();
    expect(at.querySelector<HTMLImageElement>("img")?.style.width).toBe("");
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { splitBlocks } from "../lib/blocks";
import { Markdown } from "./Markdown";

// 読む面は本文をブロックごとに描く（EditableBody が 1 ブロックずつ Markdown へ
// 渡す）。ブロックの切り方と描画が噛み合うのはこの継ぎ目なので、本文を丸ごと
// 渡す試験では「囲みが割れて中身が外に出る」形を踏まない。ここで継ぎ目を見る。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;

function show(body: string): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <>
        {splitBlocks(body).map((b) => (
          <Markdown key={b.index} body={b.src} editorial={false} />
        ))}
      </>,
    ),
  );
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  root = null;
});

const lines = (...rows: string[]) => rows.join("\n");

describe("ブロックごとに描いたときの囲み", () => {
  it("トグルは中身を抱えたまま描かれる", () => {
    const host = show(
      lines("<details>", "<summary>ひらく</summary>", "", "中の本文", "", "</details>", ""),
    );
    const box = host.querySelectorAll("details");
    expect(box).toHaveLength(1);
    expect(box[0].querySelector("summary")?.textContent).toBe("ひらく");
    // 中身がトグルの外に出ていないこと（出ていると開いても何も無い）
    expect(box[0].querySelector("p")?.textContent).toBe("中の本文");
    expect(host.textContent?.replace(/\s/g, "")).toBe("ひらく中の本文");
  });

  it("トグルの後ろの本文は一覧として描かれる", () => {
    const host = show(
      lines("<details>", "<summary>Figma</summary>", "<!-- x -->", "</details>", "- 変更点", ""),
    );
    expect(host.querySelectorAll("details")).toHaveLength(1);
    expect(host.querySelector("ul li")?.textContent).toBe("変更点");
  });

  it("入れ子のトグルは入れ子のまま描かれる", () => {
    const host = show(
      lines(
        "<details>",
        "<summary>外</summary>",
        "",
        "<details>",
        "<summary>中</summary>",
        "",
        "中の本文",
        "",
        "</details>",
        "",
        "外の本文",
        "",
        "</details>",
        "",
      ),
    );
    const outer = host.querySelector("details");
    expect(outer?.querySelectorAll("details")).toHaveLength(1);
    expect(outer?.querySelector("details p")?.textContent).toBe("中の本文");
  });

  it("段落が 2 つある callout も飾りが付く", () => {
    const host = show(lines('<callout icon="💡">', "一つめ", "", "二つめ", "</callout>", ""));
    expect(host.querySelectorAll(".mg-callout")).toHaveLength(1);
    expect(host.querySelectorAll(".mg-callout-body p")).toHaveLength(2);
  });

  it("トグルの中の callout も飾りが付く", () => {
    const host = show(
      lines(
        "<details>",
        "<summary>ひらく</summary>",
        "",
        '<callout icon="💡">',
        "中の文",
        "</callout>",
        "",
        "</details>",
        "",
      ),
    );
    expect(host.querySelector("details .mg-callout-body p")?.textContent).toBe("中の文");
  });

  it("見出しトグルは、見出しのまま summary に入る", () => {
    const host = show(
      lines("<details>", "<summary><h2>決め方</h2></summary>", "", "中の本文", "", "</details>", ""),
    );
    expect(host.querySelector("summary h2")?.textContent).toBe("決め方");
    expect(host.querySelector("details p")?.textContent).toBe("中の本文");
  });

  it("親の項目を失ったタブ字下げの一覧は、コードではなく一覧で描かれる", () => {
    const host = show(
      lines("| a | b |", "| --- | --- |", "| 1 | 2 |", "\t\t- 続きの項目", "\t\t\t- その子"),
    );
    expect(host.querySelector("pre")).toBeNull();
    expect(host.querySelector("ul li")?.textContent).toContain("続きの項目");
  });
});

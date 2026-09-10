// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CommentBody } from "./CommentMarkdown";

// コメントは記法のまま台帳に残り、出すときに組版する。
// 会話に近い書き方（単独の改行）が消えないことも併せて確かめる。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function draw(body: string): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<CommentBody body={body} />));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("コメントの本文", () => {
  it("強調・行内コードを組版する", () => {
    const el = draw("**ここ**が `undefined` になります");
    expect(el.querySelector("strong")?.textContent).toBe("ここ");
    expect(el.querySelector("code")?.textContent).toBe("undefined");
    expect(el.textContent).not.toContain("**");
  });

  it("箇条書きを箇条書きとして出す", () => {
    const el = draw("- ひとつ\n- ふたつ");
    expect(el.querySelectorAll("li")).toHaveLength(2);
  });

  it("単独の改行は改行のまま", () => {
    const el = draw("いちぎょう\nにぎょうめ");
    expect(el.querySelectorAll("br")).toHaveLength(1);
    expect(el.querySelectorAll("p")).toHaveLength(1);
  });

  it("空行は段落を分ける", () => {
    const el = draw("ひとつめ\n\nふたつめ");
    expect(el.querySelectorAll("p")).toHaveLength(2);
    expect(el.querySelectorAll("br")).toHaveLength(0);
  });

  it("チェックは押せない飾りとして出す", () => {
    const el = draw("- [x] 済み");
    expect(el.querySelector("button")).toBeNull();
    expect(el.textContent).not.toContain("[x]");
  });
});

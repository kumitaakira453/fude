// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useMarkdownKeys } from "./useMarkdownKeys";

// 入力欄との受け渡し。書き換えたあと、キャレットが狙った位置に戻ることまで見る。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const flips: number[] = [];

function Field({ start }: { start: string }) {
  const [value, setValue] = useState(start);
  const md = useMarkdownKeys(setValue, () => flips.push(1));
  return (
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={md.onKeyDown}
    />
  );
}

let root: Root | null = null;
let host: HTMLElement | null = null;

// キャレットの位置を | で示した字から入力欄を作る。
function field(marked: string): HTMLTextAreaElement {
  const at = marked.indexOf("|");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Field start={marked.replace("|", "")} />));
  const el = host.querySelector("textarea")!;
  el.setSelectionRange(at, at);
  return el;
}

function press(el: HTMLTextAreaElement, key: string, mods: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...mods }));
  });
}

// 値とキャレットを、同じ書き方に戻して見比べる。
function show(el: HTMLTextAreaElement): string {
  const { value, selectionStart: from, selectionEnd: to } = el;
  return from === to
    ? `${value.slice(0, from)}|${value.slice(from)}`
    : `${value.slice(0, from)}[${value.slice(from, to)}]${value.slice(to)}`;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("入力欄の手当て", () => {
  it("改行で箇条書きが続く", () => {
    const el = field("- あ|");
    press(el, "Enter");
    expect(show(el)).toBe("- あ\n- |");
  });

  it("記号だけの行では抜ける", () => {
    const el = field("- あ\n- |");
    press(el, "Enter");
    expect(show(el)).toBe("- あ\n|");
  });

  it("引き継ぐものが無ければ何もしない", () => {
    const el = field("ふつうの行|");
    press(el, "Enter");
    expect(show(el)).toBe("ふつうの行|");
  });

  it("⌘B で選んだところを囲む", () => {
    const el = field("あいう");
    el.setSelectionRange(1, 2);
    press(el, "b", { metaKey: true });
    expect(show(el)).toBe("あ**[い]**う");
  });

  it("⌘K でリンクにして行き先を選ぶ", () => {
    const el = field("fude");
    el.setSelectionRange(0, 4);
    press(el, "k", { metaKey: true });
    expect(show(el)).toBe("[fude]([url])");
  });

  it("⌘⇧P はプレビューの切り替えへ渡す", () => {
    const el = field("あ|");
    press(el, "P", { metaKey: true, shiftKey: true });
    expect(flips).toHaveLength(1);
    // 入力欄の中身は変えない
    expect(show(el)).toBe("あ|");
  });

  it("修飾を伴う ⌘⇧B は囲まない", () => {
    const el = field("あいう");
    el.setSelectionRange(1, 2);
    press(el, "b", { metaKey: true, shiftKey: true });
    expect(el.value).toBe("あいう");
  });

  it("修飾のない字は素通しする", () => {
    const el = field("あ|");
    press(el, "b");
    expect(show(el)).toBe("あ|");
  });
});

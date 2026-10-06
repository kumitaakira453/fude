// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { bodySizeAtom } from "../../state/atoms";
import { Choice } from "./SettingRow";

// 決まった中から 1 つ選ぶ行（字の大きさ）。押したものが選ばれ、値が残る。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  localStorage.clear();
});

describe("本文の字の大きさ", () => {
  it("押した大きさが選ばれ、設定に残る", async () => {
    const store = createStore();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <Provider store={store}>
          <Choice
            row={{
              kind: "choice",
              id: "bodysize",
              face: "look",
              group: "フォント",
              name: "本文の字の大きさ",
              note: "",
              atom: bodySizeAtom,
              options: [
                { value: "16", label: "標準" },
                { value: "18", label: "大きめ" },
              ],
            }}
          />
        </Provider>,
      ),
    );
    const big = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "大きめ")!;
    await act(async () => {
      big.click();
      await new Promise((ok) => setTimeout(ok, 0));
    });
    expect(big.getAttribute("aria-pressed")).toBe("true");
    expect(store.get(bodySizeAtom)).toBe("18");
  });
});

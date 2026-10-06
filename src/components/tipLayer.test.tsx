// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useKeyHints } from "../hooks/useKeyHints";
import { hasUiGlyph, usedUiGlyphs } from "../lib/uiIcons";
import { splitTip, TipLayer } from "./TipLayer";

// 吹き出しと、⌘ を押したときのキーの手がかり。WKWebView は title の吹き出しを
// 出さないので、名前とキーはここで出す。

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
  document.body.innerHTML = "";
});

function Hints() {
  useKeyHints();
  return null;
}

function mount(html: string) {
  host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  const layer = document.createElement("div");
  document.body.appendChild(layer);
  root = createRoot(layer);
  act(() =>
    root!.render(
      <Provider store={createStore()}>
        <Hints />
        <TipLayer />
      </Provider>,
    ),
  );
  return host;
}

const over = (el: Element) =>
  act(() => {
    el.dispatchEvent(new Event("pointerover", { bubbles: true }));
  });
const wait = (ms: number) =>
  act(async () => {
    await new Promise((ok) => setTimeout(ok, ms));
  });
const tip = () => document.querySelector<HTMLElement>(".mg-tip");

describe("吹き出し", () => {
  it("末尾に括ったキーを、名前と分けて出す", () => {
    expect(splitTip("サイドバー (⌘D)")).toEqual({ label: "サイドバー", keys: "⌘D" });
    expect(splitTip("設定（⌘,）")).toEqual({ label: "設定", keys: "⌘," });
    expect(splitTip("閉じる")).toEqual({ label: "閉じる", keys: null });
    expect(splitTip("保存", "⌘S")).toEqual({ label: "保存", keys: "⌘S" });
  });

  it("data-tip の部品を指すと、少し待ってから名前とキーを出す", async () => {
    const el = mount('<button data-tip="バージョンを保存" data-key="⌘S"><svg></svg></button>');
    over(el.querySelector("button")!);
    expect(tip()).toBeNull();
    await wait(450);
    expect(tip()?.textContent).toBe("バージョンを保存⌘S");
  });

  it("絵だけのボタンの title も吹き出しにする（title は外す）", async () => {
    const el = mount('<button title="サイドバー (⌘D)"><span class="mg-ui-icon"></span></button>');
    const button = el.querySelector("button")!;
    over(button);
    await wait(450);
    expect(tip()?.querySelector("kbd")?.textContent).toBe("⌘D");
    expect(button.hasAttribute("title")).toBe(false);
  });

  it("字のある行の title（パスの補足など）は出さない", async () => {
    const el = mount('<div title="/Users/me/a.md">a.md</div>');
    over(el.querySelector("div")!);
    await wait(450);
    expect(tip()).toBeNull();
  });

  it("押すと消える", async () => {
    const el = mount('<button data-tip="閉じる"></button>');
    over(el.querySelector("button")!);
    await wait(450);
    expect(tip()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(tip()).toBeNull();
  });
});

describe("⌘ を押したときの手がかり", () => {
  const press = (type: "keydown" | "keyup", init: KeyboardEventInit) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }));
    });

  it("⌘ だけを押したまま待つと、キーを持つ部品に手がかりを出し、離すと消す", async () => {
    mount('<button data-key="⌘S">バージョンを保存</button>');
    press("keydown", { key: "Meta", metaKey: true });
    await wait(350);
    expect(document.documentElement.hasAttribute("data-hints")).toBe(true);
    press("keyup", { key: "Meta" });
    expect(document.documentElement.hasAttribute("data-hints")).toBe(false);
  });

  it("⌘S のように続けて押したときは出さない", async () => {
    mount('<button data-key="⌘S">バージョンを保存</button>');
    press("keydown", { key: "Meta", metaKey: true });
    press("keydown", { key: "s", metaKey: true });
    await wait(350);
    expect(document.documentElement.hasAttribute("data-hints")).toBe(false);
  });
});

describe("画面の周りの絵", () => {
  it("対応表に挙げた絵は、どれも取り込まれている", () => {
    expect(usedUiGlyphs().filter((g) => !hasUiGlyph(g))).toEqual([]);
  });
});

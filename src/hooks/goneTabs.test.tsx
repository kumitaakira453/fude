// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as A from "../state/atoms";
import { TabBar } from "../components/TabBar";
import { goneAmong } from "./useGoneTabs";

// 開いているファイルが消えた・フォルダの外へ移されたら、タブの名前に取り消し線を引く。

vi.mock("./useWorkspace", () => ({
  useWorkspace: () => ({
    openInNewWindow: async () => false,
    rootFor: () => "/w",
  }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("消えたタブを見分ける", () => {
  const there = (live: string[]) => async (p: string) => live.includes(p);

  it("木に無く、実物も無いタブだけを消えたとする", async () => {
    const gone = await goneAmong(
      ["/w/a.md", "/w/b.md", "/w/c.md"],
      new Set(["/w/a.md"]),
      there(["/w/c.md"]),
    );
    expect([...gone]).toEqual(["/w/b.md"]);
  });

  it("木にあるタブは実物を見に行かない", async () => {
    const asked: string[] = [];
    await goneAmong(["/w/a.md"], new Set(["/w/a.md"]), async (p) => {
      asked.push(p);
      return true;
    });
    expect(asked).toEqual([]);
  });

  it("確かめられなかったものは消えたとしない", async () => {
    const gone = await goneAmong(["/w/a.md"], new Set(), async () => {
      throw new Error("読めない");
    });
    expect(gone.size).toBe(0);
  });
});

describe("消えたタブの見た目", () => {
  it("組にあるタブだけが取り消しの見た目になり、吹き出しで知らせる", () => {
    const store = createStore();
    store.set(A.activeFolderIdAtom, "/w");
    store.set(A.goneTabsAtom, new Set(["/w/b.md"]));
    const pane = { kind: "leaf" as const, id: "p1", tabs: ["/w/a.md", "/w/b.md"], active: 0 };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <Provider store={store}>
          <TabBar pane={pane} isActive />
        </Provider>,
      ),
    );
    const tabs = Array.from(host.querySelectorAll<HTMLElement>(".mg-tab"));
    expect(tabs.map((t) => t.classList.contains("is-gone"))).toEqual([false, true]);
    expect(tabs[1].querySelector(".mg-tab-name")!.getAttribute("title")).toContain("移動または削除されています");
  });
});

// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activePaneIdAtom,
  contentCacheAtom,
  layoutAtom,
  liveEditAtom,
  paletteOpenAtom,
  railAtom,
  readingWidthAtom,
  settingsOpenAtom,
  sidebarOpenAtom,
  sidebarTabAtom,
} from "../state/atoms";
import { reviewScreenAtom, versionScreenAtom } from "../state/review";
import { ActivityStrip } from "./ActivityStrip";
import { countText, StatusBar } from "./StatusBar";
import { Toolbar } from "./Toolbar";

// 画面の骨組み：上の段・縦の帯・足元の帯。
//
// 見たいのは「操作の置き場所が 1 つに決まっていて、押せばそこへ届くこと」。
// ボタンは名前（吹き出しの data-tip）で探す。

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("9.9.9") }));
vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({ openWorkspace: async () => {}, newDraft: async () => {} }),
}));

let wide = true;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // 幅の判定に使う。既定では右の欄を出せる広さとみなす。
  window.matchMedia = (query: string): MediaQueryList => {
    const mql: Partial<MediaQueryList> = {
      matches: wide,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    return mql as MediaQueryList;
  };
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let store: ReturnType<typeof createStore>;

function show(withDoc = true) {
  store = createStore();
  if (withDoc) {
    store.set(layoutAtom, { kind: "leaf", id: "p1", tabs: ["/w/a.md"], active: 0 });
    store.set(activePaneIdAtom, "p1");
    store.set(contentCacheAtom, new Map([["/w/a.md", "# 見出し\n本文 です"]]));
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Toolbar />
        <ActivityStrip />
        <StatusBar />
      </Provider>,
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
  localStorage.clear();
  wide = true;
});

const byTip = (tip: string) => document.querySelector<HTMLElement>(`[data-tip="${tip}"]`)!;
const click = (el: HTMLElement) => act(() => el.click());

describe("上の段", () => {
  it("サイドバー・探す・設定に届き、キーを持つ", () => {
    show();
    const side = byTip("サイドバー");
    expect(side.dataset.key).toBe("⌘D");
    click(side);
    expect(store.get(sidebarOpenAtom)).toBe(false);
    click(byTip("ファイル・操作を名前で探す"));
    expect(store.get(paletteOpenAtom)).toBe(true);
    click(byTip("設定"));
    expect(store.get(settingsOpenAtom)).toBe(true);
  });

  it("掴んで窓を動かせるところを持つ", () => {
    show();
    expect(document.querySelector(".mg-top")?.hasAttribute("data-tauri-drag-region")).toBe(true);
  });
});

describe("縦の帯", () => {
  it("押すと左の欄の面が替わり、同じ面をもう一度押すと閉じる", () => {
    show();
    click(byTip("全文を検索"));
    expect(store.get(sidebarTabAtom)).toBe("search");
    expect(store.get(sidebarOpenAtom)).toBe(true);
    click(byTip("全文を検索"));
    expect(store.get(sidebarOpenAtom)).toBe(false);
    click(byTip("ファイル"));
    expect(store.get(sidebarTabAtom)).toBe("files");
    expect(store.get(sidebarOpenAtom)).toBe(true);
  });

  it("コメント一覧の画面を開ける", () => {
    show();
    click(byTip("コメント一覧（全ファイル）"));
    expect(store.get(reviewScreenAtom)).toBe(true);
  });
});

describe("足元の帯", () => {
  it("目次とコメントの欄を切り替える", () => {
    show();
    click(byTip("コメント"));
    expect(store.get(railAtom)).toBe("comments");
    click(byTip("コメント"));
    expect(store.get(railAtom)).toBe("none");
    click(byTip("目次"));
    expect(store.get(railAtom)).toBe("toc");
  });

  it("窓が狭いときは右の欄を出せない理由を添え、押しても変わらない", () => {
    wide = false;
    show();
    const toc = document.querySelector<HTMLElement>('[data-tip^="目次（"]')!;
    expect(toc.tagName).toBe("SPAN");
  });

  it("閲覧と編集を切り替え、幅を順に替える", () => {
    show();
    click(byTip("閲覧と編集を切り替える"));
    expect(store.get(liveEditAtom)).toBe(true);
    click(byTip("本文の幅。押すと順に切り替える"));
    expect(store.get(readingWidthAtom)).toBe("wide");
  });

  it("保存の状態を押すと版の履歴を開く", () => {
    show();
    click(byTip("押すと版の履歴"));
    expect(store.get(versionScreenAtom)).toBe("/w/a.md");
  });

  it("字数と行数を出す", () => {
    show();
    expect(byTip("字数（空白と改行を除く）").textContent).toBe("8 字");
    expect(byTip("行数").textContent).toBe("L 2");
    expect(countText("あ い\nう")).toEqual({ chars: 3, lines: 2 });
  });

  it("文書を開いていなければ、文書の状態は出さない", () => {
    show(false);
    expect(document.querySelector('[data-tip="目次"]')).toBeNull();
  });
});

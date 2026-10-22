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
  claudeLinkAtom,
  claudeSessionsAtom,
  railOpenAtom,
  sidebarOpenAtom,
  sidebarTabAtom,
  workspaceAtom,
} from "../state/atoms";
import { reviewScreenAtom, versionScreenAtom } from "../state/review";
import { WorkspaceRail } from "./WorkspaceRail";
import { countText, StatusBar } from "./StatusBar";
import { Toolbar } from "./Toolbar";

// 画面の骨組み：上の段・左端の帯・足元の帯。
//
// 見たいのは「操作の置き場所が 1 つに決まっていて、押せばそこへ届くこと」。
// ボタンは名前（吹き出しの data-tip）で探す。

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("9.9.9") }));
vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({ openWorkspace: async () => {}, newDraft: async () => {} }),
}));
vi.mock("../hooks/useWorkspaceOps", () => ({
  useWorkspaceOps: () => ({ closeWorkspace: async () => {} }),
}));
vi.mock("../lib/workspaces", async (real) => ({
  ...(await real<typeof import("../lib/workspaces")>()),
  liveWorkspaces: async () => [],
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
        <WorkspaceRail />
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

  it("掴んで窓を動かせるところを持ち、ワークスペースの札は置かない", () => {
    show();
    expect(document.querySelector(".mg-top")?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(document.querySelector(".mg-top-fill")?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(document.querySelector(".mg-top [data-ws]")).toBeNull();
  });
});

describe("左端の帯", () => {
  it("上のボタンで、ワークスペースの一覧に開いて畳む", () => {
    show();
    const toggle = document.querySelector<HTMLElement>(".mg-wsrail-toggle")!;
    expect(toggle.dataset.key).toBe("⌘⇧B");
    click(toggle);
    expect(store.get(railOpenAtom)).toBe(true);
    click(document.querySelector<HTMLElement>(".mg-wsrail-toggle")!);
    expect(store.get(railOpenAtom)).toBe(false);
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

  it("保存の状態を押すとバージョン履歴を開く", () => {
    show();
    click(byTip("押すとバージョン履歴"));
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

  it("Claude の状態を押すと、左の欄を開いて Claude の面を出す", () => {
    show();
    act(() => {
      store.set(claudeLinkAtom, true);
      store.set(sidebarOpenAtom, false);
      store.set(workspaceAtom, {
        id: "w",
        name: "w",
        color: "teal",
        roots: ["/w"],
        lastOpened: 0,
        claude: { sessionId: "s", nameFollows: true },
      });
      store.set(claudeSessionsAtom, {
        sessions: [{ sessionId: "s", name: "w", kind: "background", state: "working" }],
        error: null,
        gone: new Set<string>(),
      });
    });
    click(byTip("Claude のセッション。押すと、このセッションのファイルを出す"));
    expect(store.get(sidebarOpenAtom)).toBe(true);
    expect(store.get(sidebarTabAtom)).toBe("claude");
  });

  it("コメント一覧の画面を開ける（文書を開いていなくても）", () => {
    show(false);
    click(byTip("コメント一覧（全ファイル）"));
    expect(store.get(reviewScreenAtom)).toBe(true);
  });
});

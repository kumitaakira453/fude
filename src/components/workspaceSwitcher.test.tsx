// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { RAIL_MS, RAIL_OPEN, RAIL_STRIP } from "../lib/sidebar";
import { barAtom } from "../state/workspaceBar";
import { NewWorkspace } from "./NewWorkspace";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { useKeyHints } from "../hooks/useKeyHints";
import { hintOf } from "../state/workspaceBar";
import { WorkspaceRail } from "./WorkspaceRail";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

// ワークスペースの入口。やりたいことごとに入口を 1 つに決めてある。
//   切り替える   左端の帯の札
//   探して開く   ⌘⇧P の一覧（作る口・Claude の区切りは持たない）
//   作る         帯の一番下の ＋
//   手入れ       どこで右クリックしても同じメニュー

const calls: { op: string; arg: unknown }[] = [];
const log = (op: string) => (arg?: unknown) => {
  calls.push({ op, arg });
};

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    openWorkspace: async (ws: Workspace) => log("open")(ws.id),
    openFolder: async (path: string) => log("openFolder")(path),
    openFolderInNewWindow: async () => true,
  }),
}));
vi.mock("../hooks/useWorkspaceOps", () => ({
  useWorkspaceOps: () => ({
    createWorkspace: async (opts: unknown) => log("create")(opts),
    createFromSession: async (s: { sessionId: string }) => log("fromSession")(s.sessionId),
    addRoots: async (roots: string[], id?: string) => log("addRoots")({ roots, id }),
    pickOtherFolder: async () => null,
    openInNewWindow: async (w: Workspace) => void calls.push({ op: "newWindow", arg: w.id }),
    renameWorkspace: (id: string, name: string) => log("rename")({ id, name }),
    recolorWorkspace: (id: string, color: string) => log("recolor")({ id, color }),
    deleteWorkspace: async (id: string) => log("delete")(id),
    closeWorkspace: async (id: string) => log("close")(id),
    removeWorkspaces: async (ids: string[]) => log("removeMany")(ids),
    unlinkSession: (id: string) => log("unlink")(id),
  }),
}));
// 控えの一覧を読み直すと、試験で入れた一覧がそのまま返る。
let stored: Workspace[] = [];
vi.mock("../lib/workspaces", async (real) => ({
  ...(await real<typeof import("../lib/workspaces")>()),
  liveWorkspaces: async () => [],
  listWorkspaces: async () => stored,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: async () => true }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  calls.length = 0;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  localStorage.clear();
});

const ws = (id: string, name: string, extra: Partial<Workspace> = {}): Workspace => ({
  id,
  name,
  color: "teal",
  roots: [`/w/${id}`],
  lastOpened: 1,
  ...extra,
});

// ⌘ を押したままにしたときの手がかりは、画面全体の仕組み（useKeyHints）が出す。
function Hints() {
  useKeyHints();
  return null;
}

async function show(setup?: (s: ReturnType<typeof createStore>) => void) {
  const store = createStore();
  const here = ws("a", "要件定義", { folder: "/w/a" });
  stored = [here, ws("b", "Slack 対応", { claude: { sessionId: "s", nameFollows: true } })];
  store.set(A.workspacesAtom, stored);
  store.set(A.workspaceAtom, here);
  store.set(A.foldersAtom, [
    { id: "/w/a", name: "a", path: "/w/a", lastOpened: 3 },
    { id: "/w/repo", name: "repo", path: "/w/repo", lastOpened: 2 },
  ]);
  store.set(barAtom, ["a", "b"]);
  setup?.(store);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Provider store={store}>
        <Hints />
        <WorkspaceRail />
        <WorkspaceSwitcher />
        <WorkspaceMenu />
        <NewWorkspace />
      </Provider>,
    );
  });
  return { store, el: host };
}

const pill = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-ws="${id}"]`)!;
const rightClick = (target: Element) =>
  act(() => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
// 絵の字（material-symbols の名前）を除いた、項目の言葉。
const menuItems = () =>
  Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]')).map((b) =>
    Array.from(b.childNodes)
      .filter((n) => !(n instanceof HTMLElement && n.classList.contains("material-symbols-rounded")))
      .map((n) => n.textContent)
      .join(""),
  );
const button = (label: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("button")).find((b) =>
    b.textContent?.includes(label),
  )!;

describe("切り替える：帯の札", () => {
  it("札を押すと切り替わる", async () => {
    const { el } = await show();
    act(() => pill(el, "b").click());
    expect(calls).toEqual([{ op: "open", arg: "b" }]);
  });
});

describe("手入れ：どこで右クリックしても同じメニュー", () => {
  it("札を右クリックすると手入れのメニューが出る", async () => {
    const { el } = await show();
    rightClick(pill(el, "b"));
    expect(menuItems()).toEqual([
      "名前を変更",
      "フォルダを追加…",
      "新しいウィンドウで開く",
      "Claude のセッションとの連携を解除",
      "削除",
    ]);
  });

  it("⌘⇧P の行を右クリックしても、同じメニューが出る", async () => {
    const { el } = await show((s) => s.set(A.workspaceSwitcherOpenAtom, true));
    const row = Array.from(el.querySelectorAll("[data-idx]")).find((r) =>
      r.textContent?.includes("Slack 対応"),
    )!;
    rightClick(row);
    expect(menuItems()[0]).toBe("名前を変更");
    expect(menuItems()).toContain("削除");
  });

  it("開いているワークスペースも、メニューから削除できる", async () => {
    const { el } = await show();
    rightClick(pill(el, "a"));
    expect(menuItems()).toContain("削除");
    expect(menuItems()).not.toContain("新しいウィンドウで開く");
  });

  it("ツールバーから外す項目は持たない", async () => {
    const { el } = await show();
    rightClick(pill(el, "b"));
    expect(menuItems()).not.toContain("ツールバーから外す");
    expect(menuItems()).not.toContain("ツールバーに表示");
  });

  it("メニューから名前・色・削除が効く", async () => {
    const { el, store } = await show();
    rightClick(pill(el, "b"));
    act(() => button("名前を変更").click());
    const input = document.querySelector<HTMLInputElement>('[role="menu"] input')!;
    act(() => {
      input.value = "Slack";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(calls.at(-1)).toEqual({ op: "rename", arg: { id: "b", name: "Slack" } });

    rightClick(pill(el, "b"));
    act(() => document.querySelectorAll<HTMLElement>(".mg-ws-menu-colors button")[3].click());
    expect(calls.at(-1)?.op).toBe("recolor");

    rightClick(pill(el, "b"));
    act(() => button("削除").click());
    expect(calls.at(-1)).toEqual({ op: "close", arg: "b" });
    // 札の並びは削除の中で書き換える。メニューは触らない。
    expect(store.get(barAtom)).toEqual(["a", "b"]);
  });
});

describe("⌘ を押しているあいだの番号", () => {
  const press = (type: "keydown" | "keyup", init: KeyboardEventInit) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }));
    });
  const hints = (el: HTMLElement) =>
    Array.from(el.querySelectorAll(".mg-wsrail-hint")).map((h) => h.textContent);
  const wait = (ms: number) =>
    act(async () => {
      await new Promise((ok) => setTimeout(ok, ms));
    });

  it("⌘ だけを押したまま待つと札に番号が出て、離すと消える", async () => {
    const { el } = await show();
    press("keydown", { key: "Meta", metaKey: true });
    expect(hints(el)).toEqual([]);
    await wait(500);
    // 0.8 秒待つまでは出さない（⌘ と別のキーを続けて押す途中で出さない）。
    expect(hints(el)).toEqual([]);
    await wait(400);
    expect(hints(el)).toEqual(["⌘1", "⌘2"]);
    press("keyup", { key: "Meta" });
    expect(hints(el)).toEqual([]);
  });

  it("⌘S のように続けて別のキーを押したときは出さない", async () => {
    const { el } = await show();
    press("keydown", { key: "Meta", metaKey: true });
    press("keydown", { key: "s", metaKey: true });
    await wait(900);
    expect(hints(el)).toEqual([]);
  });

  it("番号は ⌘1〜8 が上から、⌘9 は一番下の札", () => {
    expect([0, 1, 7, 8].map((i) => hintOf(i, 12))).toEqual(["1", "2", "8", null]);
    expect(hintOf(11, 12)).toBe("9");
    expect(hintOf(8, 9)).toBe("9");
  });
});

describe("右クリックで字を選ばせない", () => {
  it("札の上で右ボタンを押しても、下の語の選択を始めない", async () => {
    const { el } = await show();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 });
    act(() => {
      pill(el, "b").dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
    const left = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      pill(el, "b").dispatchEvent(left);
    });
    expect(left.defaultPrevented).toBe(false);
  });
});

describe("手入れ：画面を指して開く", () => {
  it("フォルダを選ぶ画面を指せば、メニューを経ずにその画面から開く", async () => {
    const { store } = await show();
    act(() => store.set(A.workspaceMenuAtom, { id: "a", x: 10, y: 10, step: "folders" }));
    expect(document.querySelector('[role="menu"] [role="menuitem"]')).toBeNull();
    expect(document.body.textContent).toContain("repo");
  });
});

describe("探して開く：⌘⇧P", () => {
  it("作る口も Claude の区切りも持たない", async () => {
    const { el } = await show((s) => {
      s.set(A.workspaceSwitcherOpenAtom, true);
      s.set(A.claudeLinkAtom, true);
    });
    const text = el.textContent ?? "";
    expect(text).not.toContain("新規作成");
    expect(text).not.toContain("Claude のセッションから");
  });

  it("まだワークスペースの無いフォルダも並び、選ぶと開く", async () => {
    const { el } = await show((s) => s.set(A.workspaceSwitcherOpenAtom, true));
    const row = Array.from(el.querySelectorAll<HTMLElement>("[data-idx]")).find((r) =>
      r.textContent?.includes("/w/repo"),
    )!;
    act(() => row.click());
    expect(calls).toEqual([{ op: "openFolder", arg: "/w/repo" }]);
  });

  it("⌘⏎ は別のワークスペースなら新しいウィンドウで開き、今いるものなら何もしない", async () => {
    const { el, store } = await show((s) => s.set(A.workspaceSwitcherOpenAtom, true));
    const rowOf = (name: string) =>
      Array.from(el.querySelectorAll<HTMLElement>("[data-idx]")).find((r) =>
        r.textContent?.includes(name),
      )!;
    act(() => rowOf("要件定義").dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })));
    expect(calls).toEqual([]);
    act(() => store.set(A.workspaceSwitcherOpenAtom, true));
    act(() => rowOf("Slack 対応").dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })));
    expect(calls).toEqual([{ op: "newWindow", arg: "b" }]);
  });
});

describe("探して開く：右の中身", () => {
  const detail = () => document.querySelector<HTMLElement>(".mg-pal-detail");
  const input = () => document.querySelector<HTMLInputElement>(".mg-pal-in input")!;
  const key = (k: string) =>
    act(() => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    });

  it("選んでいるワークスペースのフォルダと開いているファイルを出し、↑↓ で替わる", async () => {
    await show((s) => {
      s.set(A.workspaceSwitcherOpenAtom, true);
      s.set(A.layoutAtom, { kind: "leaf", id: "p1", tabs: ["/w/a/メモ.md"], active: 0 });
    });
    // 開いた時点では 2 番目（直前のもの）を選んでいる。
    expect(detail()?.textContent).toContain("Slack 対応");
    expect(detail()?.textContent).toContain("/w/b");
    key("ArrowUp");
    expect(detail()?.textContent).toContain("要件定義");
    expect(detail()?.textContent).toContain("メモ.md");
    expect(detail()?.textContent).toContain("このウィンドウ");
  });

  it("中身に押せるものを置かない（一覧の行と取り違えない）", async () => {
    await show((s) => s.set(A.workspaceSwitcherOpenAtom, true));
    expect(detail()?.querySelector("button, [data-idx]")).toBeNull();
  });
});

describe("作る：＋", () => {
  it("作り方を並べ、今のフォルダで作るのは 1 回押すだけ", async () => {
    const { el } = await show();
    act(() => el.querySelector<HTMLElement>('.mg-wsrail-add[data-key="⌘T"]')!.click());
    expect(document.body.textContent).toContain("フォルダを選んで新規作成");
    expect(document.body.textContent).toContain("今のタブを複製して新規作成");
    act(() => button("今のフォルダで新規作成").click());
    expect(calls).toEqual([{ op: "create", arg: { roots: ["/w/a"] } }]);
  });

  it("Claude の連携を切っていれば、セッションから作る項目は出さない", async () => {
    const { el } = await show();
    act(() => el.querySelector<HTMLElement>('.mg-wsrail-add[data-key="⌘T"]')!.click());
    expect(document.body.textContent).not.toContain("Claude のセッションから作成");
  });

  it("連携を入れていれば、まだワークスペースの無いセッションだけを並べ、押すと作る", async () => {
    const { el } = await show((s) => {
      s.set(A.claudeLinkAtom, true);
      s.set(A.claudeSessionsAtom, {
        sessions: [
          { sessionId: "s", name: "結びつき済み", kind: "background" },
          { sessionId: "t", name: "[V]新しいセッション", kind: "background", state: "working" },
        ],
        error: null,
        gone: new Set<string>(),
      });
    });
    act(() => el.querySelector<HTMLElement>('.mg-wsrail-add[data-key="⌘T"]')!.click());
    // 作成済みのものは帯から開くので、ここには出さない。
    expect(document.body.textContent).not.toContain("結びつき済み");
    act(() => button("[V]新しいセッション").click());
    expect(calls).toEqual([{ op: "fromSession", arg: "t" }]);
  });

  it("指したセッションの中身を右に出す（場所。ワークスペースが無ければその節は出さない）", async () => {
    const { el } = await show((s) => {
      s.set(A.claudeLinkAtom, true);
      s.set(A.claudeSessionsAtom, {
        sessions: [{ sessionId: "t", name: "[V]新しいセッション", kind: "background", cwd: "/w/t" }],
        error: null,
        gone: new Set<string>(),
      });
    });
    act(() => el.querySelector<HTMLElement>('.mg-wsrail-add[data-key="⌘T"]')!.click());
    // 作り方の 3 行の下にセッションが並ぶ。↓ で選んでいく。
    const input = document.querySelector<HTMLInputElement>(".mg-pal-in input")!;
    for (let i = 0; i < 3; i++) {
      act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      });
    }
    const detail = document.querySelector(".mg-pal-detail")!.textContent ?? "";
    expect(detail).toContain("[V]新しいセッション");
    expect(detail).toContain("/w/t");
    expect(detail).not.toContain("ワークスペース");
  });
});

describe("Claude のセッションの終わり", () => {
  it("セッションが一覧から外れたら、終了の印（斜線）を付けて札を沈める", async () => {
    const { el } = await show((s) => {
      s.set(A.claudeLinkAtom, true);
      s.set(A.claudeSessionsAtom, { sessions: [], error: null, gone: new Set<string>() });
    });
    expect(pill(el, "b").querySelector(".mg-st.is-gone")).not.toBeNull();
    expect(pill(el, "b").classList.contains("is-gone")).toBe(true);
    expect(pill(el, "a").querySelector(".mg-st")).toBeNull();
    expect(pill(el, "a").classList.contains("is-gone")).toBe(false);
  });

  it("開いた一覧では「終了」と出し、頭の「整理」から選んでまとめて削除する", async () => {
    const { el } = await show((s) => {
      s.set(A.railOpenAtom, true);
      s.set(A.claudeLinkAtom, true);
      s.set(A.claudeSessionsAtom, { sessions: [], error: null, gone: new Set<string>(["s2"]) });
      s.set(A.workspacesAtom, [
        ws("a", "要件定義", { folder: "/w/a" }),
        ws("b", "Slack 対応", { claude: { sessionId: "s", nameFollows: true } }),
        ws("c", "消えた調査", { claude: { sessionId: "s2", nameFollows: true } }),
      ]);
      s.set(barAtom, ["a", "b", "c"]);
    });
    expect(pill(el, "b").querySelector(".mg-wsrail-state")?.textContent).toBe("終了");
    expect(pill(el, "c").querySelector(".mg-wsrail-state")?.textContent).toBe("削除済み");
    const tidy = el.querySelector<HTMLElement>(".mg-wsrail-tidy")!;
    expect(tidy.textContent).toBe("整理（2）");
    act(() => tidy.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const rows = dialog.querySelectorAll<HTMLElement>(".mg-tidy-row");
    expect(rows).toHaveLength(2);
    // 1 件押すと「残す」に替わり、残りだけを削除する。
    act(() => rows[0].click());
    expect(rows[0].querySelector(".mg-tidy-tag")?.textContent).toBe("残す");
    const go = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent?.includes("件を削除"))!;
    expect(go.textContent).toBe("1 件を削除");
    act(() => go.click());
    expect(calls).toEqual([{ op: "removeMany", arg: ["c"] }]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("終了したセッションが無ければ「整理」を出さない", async () => {
    const { el } = await show((s) => {
      s.set(A.railOpenAtom, true);
      s.set(A.claudeLinkAtom, true);
      s.set(A.claudeSessionsAtom, {
        sessions: [{ sessionId: "s", name: "s", kind: "bg", status: "idle" }],
        error: null,
        gone: new Set<string>(),
      });
    });
    expect(el.querySelector(".mg-wsrail-tidy")).toBeNull();
  });
});

describe("帯を開いた一覧", () => {
  it("× はワークスペースの削除を頼み、押した行へは切り替えない", async () => {
    const { el } = await show((s) => s.set(A.railOpenAtom, true));
    act(() => pill(el, "b").querySelector<HTMLElement>(".mg-wsrail-x")!.click());
    expect(calls).toEqual([{ op: "close", arg: "b" }]);
  });

  it("行を押すと移って畳む", async () => {
    const { el, store } = await show((s) => s.set(A.railOpenAtom, true));
    act(() => pill(el, "b").click());
    expect(calls).toEqual([{ op: "open", arg: "b" }]);
    expect(store.get(A.railOpenAtom)).toBe(false);
  });

  it("畳んでも、縮みきるまでは名前を描いたままにし、そのあと外す", async () => {
    const { el, store } = await show((s) => s.set(A.railOpenAtom, true));
    const names = () => el.querySelectorAll(".mg-wsrail-name").length;
    expect(names()).toBeGreaterThan(0);
    act(() => store.set(A.railOpenAtom, false));
    expect(el.querySelector(".mg-wsrail")!.classList.contains("is-open")).toBe(false);
    expect(names()).toBeGreaterThan(0);
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, RAIL_MS + 50));
    });
    expect(names()).toBe(0);
  });

  it("開いた幅は控えの幅（既定は RAIL_OPEN）、畳むと帯の幅", async () => {
    const { el, store } = await show((s) => s.set(A.railOpenAtom, true));
    const nav = el.querySelector<HTMLElement>(".mg-wsrail")!;
    expect(nav.style.width).toBe(`${RAIL_OPEN}px`);
    // 掴んで変えた幅（窓ごとの控え）があれば、その幅で開く。
    act(() => {
      store.set(A.wsRailWidthAtom, 320);
      store.set(A.railOpenAtom, true);
    });
    expect(nav.style.width).toBe("320px");
    act(() => store.set(A.railOpenAtom, false));
    expect(nav.style.width).toBe(`${RAIL_STRIP}px`);
  });

  it("フォルダごとに見出しを付ける", async () => {
    const { el } = await show((s) => {
      s.set(A.railOpenAtom, true);
      s.set(A.workspaceAtom, ws("a", "要件定義", { roots: ["/w/repo"] }));
      s.set(A.workspacesAtom, [
        ws("a", "要件定義", { roots: ["/w/repo"] }),
        ws("b", "Slack 対応", { roots: ["/w/repo/.claude", "/w/repo"] }),
        ws("c", "メモ", { roots: ["/w/notes"] }),
      ]);
      s.set(barAtom, ["a", "c", "b"]);
    });
    expect(Array.from(el.querySelectorAll(".mg-wsrail-group-head")).map((h) => h.textContent)).toEqual([
      "repo",
      "notes",
    ]);
    expect(Array.from(el.querySelectorAll("[data-ws]")).map((p) => p.getAttribute("data-ws"))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("帯の札を指したとき", () => {
  it("しばらく指していると中身の札を出し、離れると消す", async () => {
    const { el } = await show();
    act(() => {
      pill(el, "b").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(document.querySelector(".mg-wscard")).toBeNull();
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 650));
    });
    expect(document.querySelector(".mg-wscard")?.textContent).toContain("Slack 対応");
    act(() => {
      pill(el, "b").dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(document.querySelector(".mg-wscard")).toBeNull();
  });
});

describe("帯の並び", () => {
  it("並びに載っていないワークスペースも、末尾に札が出る", async () => {
    const { el, store } = await show((s) => s.set(barAtom, ["b"]));
    expect(store.get(barAtom)).toEqual(["b", "a"]);
    expect(Array.from(el.querySelectorAll("[data-ws]")).map((p) => p.getAttribute("data-ws"))).toEqual([
      "b",
      "a",
    ]);
  });
});

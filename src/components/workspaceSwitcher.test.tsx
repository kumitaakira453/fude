// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { barAtom } from "../state/workspaceBar";
import { NewWorkspace } from "./NewWorkspace";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { useKeyHints } from "../hooks/useKeyHints";
import { hintOf, WorkspacePills } from "./WorkspacePills";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

// ワークスペースの入口。やりたいことごとに入口を 1 つに決めてある。
//   切り替える   ツールバーの札
//   探して開く   ⌘⇧P の一覧（作る口・Claude の区切りは持たない）
//   作る         札の並びの末尾の ＋
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
        <WorkspacePills />
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

describe("切り替える：ツールバーの札", () => {
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
    Array.from(el.querySelectorAll(".mg-ws-pill-hint")).map((h) => h.textContent);
  const wait = (ms: number) =>
    act(async () => {
      await new Promise((ok) => setTimeout(ok, ms));
    });

  it("⌘ だけを押したまま待つと札に番号が出て、離すと消える", async () => {
    const { el } = await show();
    press("keydown", { key: "Meta", metaKey: true });
    expect(hints(el)).toEqual([]);
    await wait(350);
    expect(hints(el)).toEqual(["⌘1", "⌘2"]);
    press("keyup", { key: "Meta" });
    expect(hints(el)).toEqual([]);
  });

  it("⌘S のように続けて別のキーを押したときは出さない", async () => {
    const { el } = await show();
    press("keydown", { key: "Meta", metaKey: true });
    press("keydown", { key: "s", metaKey: true });
    await wait(350);
    expect(hints(el)).toEqual([]);
  });

  it("番号は ⌘1〜8 が左から、⌘9 は一番右の札", () => {
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

describe("作る：＋", () => {
  it("作り方を並べ、今のフォルダで作るのは 1 回押すだけ", async () => {
    const { el } = await show();
    act(() => el.querySelector<HTMLElement>('.mg-ws-pill-add[data-key="⌘T"]')!.click());
    expect(document.body.textContent).toContain("フォルダを選んで新規作成");
    expect(document.body.textContent).toContain("今のタブを複製して新規作成");
    act(() => button("今のフォルダで新規作成").click());
    expect(calls).toEqual([{ op: "create", arg: { roots: ["/w/a"] } }]);
  });

  it("Claude の連携を切っていれば、セッションから作る項目は出さない", async () => {
    const { el } = await show();
    act(() => el.querySelector<HTMLElement>('.mg-ws-pill-add[data-key="⌘T"]')!.click());
    expect(document.body.textContent).not.toContain("Claude のセッションから作成");
  });

  it("連携を入れていれば、セッションを並べる（作成済みのものは印を付け、押すと開く）", async () => {
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
    act(() => el.querySelector<HTMLElement>('.mg-ws-pill-add[data-key="⌘T"]')!.click());
    const made = button("結びつき済み");
    expect(made.textContent).toContain("作成済み");
    expect(button("[V]新しいセッション").textContent).not.toContain("作成済み");
    act(() => button("[V]新しいセッション").click());
    expect(calls).toEqual([{ op: "fromSession", arg: "t" }]);
    act(() => el.querySelector<HTMLElement>('.mg-ws-pill-add[data-key="⌘T"]')!.click());
    act(() => button("結びつき済み").click());
    expect(calls.at(-1)).toEqual({ op: "open", arg: "b" });
  });
});

describe("Claude のセッションの終わり", () => {
  it("ワークスペースのあるセッションが終わったら、札に「終了」と出す", async () => {
    const { el } = await show((s) => {
      s.set(A.claudeLinkAtom, true);
      s.set(A.claudeSessionsAtom, { sessions: [], error: null, gone: new Set<string>() });
    });
    expect(pill(el, "b").textContent).toContain("終了");
    expect(pill(el, "a").textContent).not.toContain("終了");
  });
});

describe("札の ×", () => {
  it("× はワークスペースの削除を頼み、押した札へは切り替えない", async () => {
    const { el } = await show();
    act(() => pill(el, "b").querySelector<HTMLElement>(".mg-ws-pill-x")!.click());
    expect(calls).toEqual([{ op: "close", arg: "b" }]);
  });

  it("中クリックでも削除を頼む", async () => {
    const { el } = await show();
    act(() => {
      pill(el, "b").dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    });
    expect(calls).toEqual([{ op: "close", arg: "b" }]);
  });
});

describe("札の並び", () => {
  it("札の並びの空きは窓を掴む所にし、札そのものは掴む所にしない", async () => {
    const { el } = await show();
    expect(el.querySelector(".mg-ws-pills-wrap")!.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(el.querySelector(".mg-ws-pills")!.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(pill(el, "a").hasAttribute("data-tauri-drag-region")).toBe(false);
  });


  it("並びに載っていないワークスペースも、末尾に札が出る", async () => {
    const { el, store } = await show((s) => s.set(barAtom, ["b"]));
    expect(store.get(barAtom)).toEqual(["b", "a"]);
    expect(Array.from(el.querySelectorAll("[data-ws]")).map((p) => p.getAttribute("data-ws"))).toEqual([
      "b",
      "a",
    ]);
  });
});

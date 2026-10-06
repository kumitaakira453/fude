// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claudeLinkAtom,
  imageDirAtom,
  liveEditAtom,
  settingsFaceAtom,
  settingsOpenAtom,
} from "../state/atoms";
import { Settings } from "./Settings";

// 設定。ウィンドウ全体を使う画面で、面は責務で分け、面をまたいで探せる。
//
// 見たいのは「探している設定に辿り着けること」と「触ったら効くこと」。

const renamed: [string, string][] = [];
const deleted: string[] = [];

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("9.9.9") }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: async () => true }));
vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({ openWorkspace: async () => {} }),
}));
vi.mock("../hooks/useWorkspaceOps", () => ({
  useWorkspaceOps: () => ({
    renameWorkspace: (id: string, name: string) => void renamed.push([id, name]),
    recolorWorkspace: () => {},
    deleteWorkspace: async (id: string) => void deleted.push(id),
    removeRoot: async () => {},
    addRoots: async () => {},
    pickOtherFolder: async () => null,
  }),
}));
vi.mock("../lib/workspaces", async (real) => ({
  ...(await real<typeof import("../lib/workspaces")>()),
  listWorkspaces: async () => [],
}));
vi.mock("../lib/claude", async (real) => ({
  ...(await real<typeof import("../lib/claude")>()),
  claudeBinPath: async () => null,
  claudeSessions: async () => {
    throw new Error("claude コマンドが見つかりません");
  },
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});

beforeEach(() => {
  renamed.length = 0;
  deleted.length = 0;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let store: ReturnType<typeof createStore>;

function open(before?: (s: ReturnType<typeof createStore>) => void) {
  store = createStore();
  store.set(settingsOpenAtom, true);
  before?.(store);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Settings />
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
  // 控えは窓ごとに残る。次の試しへ持ち越すと、書いていない値が入っている。
  localStorage.clear();
});

const box = () => document.querySelector<HTMLElement>(".mg-set")!;
const page = () => box().querySelector<HTMLElement>(".mg-set-page")!;
const text = () => page().textContent ?? "";
// Beta の札も同じ入れ物に入るので、名前だけを見る。
const names = () =>
  Array.from(page().querySelectorAll(".mg-set-row-name")).map((el) =>
    (el.textContent ?? "").replace(/Beta$/, ""),
  );
const face = (label: string) =>
  Array.from(box().querySelectorAll<HTMLElement>(".mg-set-tab")).find((el) =>
    el.textContent?.includes(label),
  )!;
const find = () => box().querySelector<HTMLInputElement>(".mg-set-find input")!;

const type = (field: HTMLInputElement, value: string) => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const search = (value: string) => type(find(), value);
const press = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });

describe("画面", () => {
  it("暗くして重ねる小窓ではなく、ウィンドウ全体の画面で出す", () => {
    open();
    expect(box()).not.toBeNull();
    expect(document.querySelector(".mg-set-back")).toBeNull();
    expect(box().querySelector(".mg-set-close")?.textContent).toContain("閉じる");
  });

  it("右上の「閉じる」で閉じる", () => {
    open();
    act(() => box().querySelector<HTMLElement>(".mg-set-close")!.click());
    expect(store.get(settingsOpenAtom)).toBe(false);
  });

  it("Esc は、探しているときは探す字を消し、そうでなければ閉じる", () => {
    open();
    search("画像");
    press({ key: "Escape" });
    expect(store.get(settingsOpenAtom)).toBe(true);
    expect(find().value).toBe("");
    press({ key: "Escape" });
    expect(store.get(settingsOpenAtom)).toBe(false);
  });
});

describe("面を責務で分ける", () => {
  it("はじめは見た目の面", () => {
    open();
    expect(text()).toContain("テーマ");
    expect(text()).toContain("フォント");
  });

  it("編集の面には、書くときの設定だけを出す", () => {
    open();
    act(() => face("編集").click());
    expect(names()).toContain("リアルタイム編集");
    expect(names()).toContain("画像の保存先フォルダ");
    expect(names()).not.toContain("Markdown 以外のファイルも表示する");
  });

  it("試験中という面は持たない（熟し具合は札で示す）", () => {
    open();
    expect(box().textContent).not.toContain("試験中");
    act(() => face("編集").click());
    expect(page().querySelector(".mg-set-beta")).not.toBeNull();
  });

  it("行ごとの絵は出さない（絵は面の一覧だけ）", () => {
    open();
    act(() => face("編集").click());
    const row = page().querySelector(".mg-set-row")!;
    expect(row.querySelector(".material-symbols-rounded")).toBeNull();
  });
});

describe("設定を探す", () => {
  it("面をまたいで当て、面ごとに見出しを添える", () => {
    open();
    search("画像");
    expect(names()).toContain("画像の保存先フォルダ");
    expect(names()).toContain("Markdown 以外のファイルも表示する");
    const wheres = Array.from(page().querySelectorAll(".mg-set-where")).map((el) => el.textContent);
    expect(wheres.some((w) => w?.includes("編集"))).toBe(true);
    expect(wheres.some((w) => w?.includes("ファイル"))).toBe(true);
  });

  it("面の見出しを押すとその面へ移る", () => {
    open();
    search("画像の保存先フォルダ");
    act(() => page().querySelector<HTMLElement>(".mg-set-where")!.click());
    expect(store.get(settingsFaceAtom)).toBe("write");
    expect(find().value).toBe("");
  });

  it("別名でも当たる", () => {
    open();
    search("wysiwyg");
    expect(names()).toContain("リアルタイム編集");
  });

  it("キー操作も探せる（何をするかで当て、そのキーだけを出す）", () => {
    open();
    search("太字");
    const keys = Array.from(page().querySelectorAll("kbd")).map((el) => el.textContent);
    expect(keys).toContain("⌘B");
    expect(keys).not.toContain("⌘O");
  });

  it("当たりが無ければその旨を出す（黙って空にしない）", () => {
    open();
    search("そんな設定はない");
    expect(page().querySelector(".mg-set-none")?.textContent).toContain("ありません");
  });
});

describe("触ったら効く", () => {
  it("スイッチを押すと設定が変わる", () => {
    open();
    act(() => face("編集").click());
    expect(store.get(liveEditAtom)).toBe(false);
    const row = Array.from(page().querySelectorAll<HTMLElement>(".mg-set-row")).find((el) =>
      el.textContent?.includes("リアルタイム編集"),
    )!;
    act(() => row.click());
    expect(store.get(liveEditAtom)).toBe(true);
  });

  it("打ち込みの欄がそのまま設定になる", () => {
    open();
    act(() => face("編集").click());
    type(page().querySelector<HTMLInputElement>(".mg-set-drop input")!, "素材");
    expect(store.get(imageDirAtom)).toBe("素材");
  });
});

describe("キー操作の面", () => {
  it("一覧を面の中に出す（別の小窓にしない）", () => {
    open((s) => s.set(settingsFaceAtom, "keys"));
    const keys = Array.from(page().querySelectorAll("kbd")).map((el) => el.textContent);
    expect(keys).toContain("⌘P");
    expect(keys).toContain("⌃Tab");
  });
});

describe("重複を持たない", () => {
  it("ワークスペースの面は無い（手入れは右クリックのメニューだけ）", () => {
    open();
    const tabs = Array.from(box().querySelectorAll(".mg-set-tab")).map((el) => el.textContent);
    expect(tabs.some((t) => t?.includes("ワークスペース"))).toBe(false);
  });

  it("Claude の連携の入切は設定の中で 1 か所だけ", () => {
    open();
    search("claude");
    const rows = Array.from(page().querySelectorAll(".mg-set-row-name")).filter((el) =>
      el.textContent?.includes("Claude のセッションからワークスペースを作る"),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("Claude の面", () => {
  it("読めないときは、その理由を出す", async () => {
    open((s) => {
      s.set(settingsFaceAtom, "claude");
      s.set(claudeLinkAtom, true);
    });
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 10));
    });
    expect(text()).toContain("見つかりません");
    expect(text()).toContain("読み込めません");
  });
});

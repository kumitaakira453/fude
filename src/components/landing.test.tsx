// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../lib/workspaces";
import { newWorkspaceAtom, workspacesAtom } from "../state/atoms";
import { barAtom } from "../state/workspaceBar";
import { Landing } from "./Landing";

// スタート画面。ワークスペースを帯と同じまとまり・同じ順で並べ、押すと開くこと、
// 1 つも無いときは開く口だけを出すことを見る。

const opened: string[] = [];
const made: string[] = [];
const entered: string[] = [];
const switched: string[] = [];
let picked: string | null = null;

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    openFolder: async (path: string) => {
      entered.push(path);
    },
    // 実物と同じく、待たずにその場で開く（確かめは開いたあと）。
    openDoc: (abs: string) => {
      opened.push(abs);
    },
    newDraft: async () => {
      made.push("draft");
      return "/drafts/新しい.md";
    },
    openWorkspace: async (ws: Workspace) => {
      switched.push(ws.id);
    },
  }),
}));

vi.mock("../hooks/useWorkspaceOps", () => ({
  useWorkspaceOps: () => ({ removeWorkspaces: async () => {} }),
}));

vi.mock("../lib/fsAccess", async (real) => {
  const mod = await real<typeof import("../lib/fsAccess")>();
  return {
    ...mod,
    pickDirectory: async () => null,
  };
});

vi.mock("../lib/kind", async (real) => {
  const mod = await real<typeof import("../lib/kind")>();
  return { ...mod, pickDocFile: async () => picked };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

const ws = (id: string, folder: string): Workspace => ({
  id,
  name: `名前 ${id}`,
  color: "teal",
  roots: [folder],
  folder,
  lastOpened: Date.now(),
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let store = createStore();

function show(list: Workspace[] = [], bar: string[] = list.map((w) => w.id)) {
  store = createStore();
  store.set(workspacesAtom, list);
  store.set(barAtom, bar);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Landing />
      </Provider>,
    ),
  );
  return host;
}

beforeEach(() => {
  opened.length = 0;
  entered.length = 0;
  made.length = 0;
  switched.length = 0;
  picked = null;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const rows = (at: HTMLElement) => [...at.querySelectorAll<HTMLElement>(".mg-landing-row")];
const openButton = (at: HTMLElement, title: string) =>
  [...at.querySelectorAll<HTMLElement>(".mg-landing-act")].find((b) =>
    b.textContent?.includes(title),
  )!;

const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

describe("ワークスペースの一覧", () => {
  it("フォルダごとのまとまりで、帯と同じ順に並ぶ", () => {
    const at = show(
      [ws("a", "/x/仕事"), ws("b", "/x/趣味"), ws("c", "/x/仕事")],
      ["a", "b", "c"],
    );
    expect([...at.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["仕事", "趣味"]);
    expect(rows(at).map((r) => r.dataset.ws)).toEqual(["a", "c", "b"]);
  });

  it("列に載っていないものは末尾に並ぶ", () => {
    const at = show([ws("a", "/x/仕事"), ws("b", "/x/趣味")], ["b"]);
    expect(rows(at).map((r) => r.dataset.ws)).toEqual(["b", "a"]);
  });

  it("行を押すとそのワークスペースを開く", () => {
    const at = show([ws("a", "/x/仕事")]);
    click(rows(at)[0]);
    expect(switched).toEqual(["a"]);
  });

  it("1 つも無ければ一覧を出さず、開く口だけを出す", () => {
    const at = show([]);
    expect(rows(at)).toEqual([]);
    expect(at.querySelector("h2")).toBeNull();
    expect(at.querySelectorAll(".mg-landing-act").length).toBe(4);
  });
});

describe("開く口", () => {
  it("ワークスペースを作るを押すと、作る一覧を開く", () => {
    const at = show([ws("a", "/x/仕事")]);
    click(openButton(at, "ワークスペースを作る"));
    expect(store.get(newWorkspaceAtom)).toBe(true);
  });

  it("新しいメモを押すと下書きを作る", () => {
    const at = show([]);
    click(openButton(at, "新しいメモ"));
    expect(made).toEqual(["draft"]);
  });

  it("選んだ 1 枚を開く", async () => {
    picked = "/a/選んだ.md";
    const at = show([]);
    click(openButton(at, "ファイルを開く"));
    await act(async () => {});
    expect(opened).toEqual(["/a/選んだ.md"]);
  });

  it("選ばずに閉じたら何も開かない", async () => {
    const at = show([]);
    click(openButton(at, "ファイルを開く"));
    await act(async () => {});
    expect(opened).toEqual([]);
  });
});

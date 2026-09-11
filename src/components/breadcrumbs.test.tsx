// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../lib/fsAccess";
import { Breadcrumbs } from "./Breadcrumbs";

// 1 枚だけ開いているときの道筋。木を持っていないので、絶対パスを区切りに割って
// 出し、プルダウンはその場でフォルダを読む。

const opened: string[] = [];
let level: Record<string, TreeNode[]> = {};

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    openFile: () => {},
    openDoc: (abs: string) => {
      opened.push(abs);
    },
  }),
}));

vi.mock("../lib/fsAccess", async (real) => {
  const mod = await real<typeof import("../lib/fsAccess")>();
  return {
    ...mod,
    readLevel: async (dir: string) => level[dir] ?? [],
  };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  // jsdom は描画を持たないので、選んだ行を見える位置へ送る道具が無い。
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const file = (abs: string): TreeNode => ({
  name: abs.split("/").pop()!,
  path: abs,
  abs,
  kind: "file",
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function show(path: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={createStore()}>
        <Breadcrumbs path={path} paneId="p1" lazy />
      </Provider>,
    ),
  );
  return host;
}

beforeEach(() => {
  opened.length = 0;
  level = {};
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll(".mg-crumb-pop").forEach((n) => n.remove());
  root = null;
  host = null;
});

const crumbs = (at: HTMLElement) => [...at.querySelectorAll("button")];
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const pop = () => document.querySelector<HTMLElement>(".mg-crumb-pop");

describe("1 枚だけのときの道筋", () => {
  it("先頭側を畳み、ファイル名は必ず出す", () => {
    const at = show("/Users/me/Downloads/設計.md");
    expect(crumbs(at).map((b) => b.textContent)).toEqual([
      "…",
      "Downloads",
      "設計.md",
    ]);
  });

  it("区切りには、そこまでの道筋が添う", () => {
    const at = show("/Users/me/Downloads/設計.md");
    expect(crumbs(at).map((b) => b.title)).toEqual([
      "/Users/me",
      "/Users/me/Downloads",
      "/Users/me/Downloads/設計.md",
    ]);
  });

  it("浅い道筋なら畳まない", () => {
    const at = show("/docs/設計.md");
    expect(crumbs(at).map((b) => b.textContent)).toEqual(["docs", "設計.md"]);
  });
});

describe("区切りのプルダウン", () => {
  it("押すとその階層を読みにいき、中身が出る", async () => {
    level["/Users/me/Downloads"] = [file("/Users/me/Downloads/隣.md")];
    const at = show("/Users/me/Downloads/設計.md");
    click(crumbs(at).at(-1)!);
    // 押した瞬間は開くだけ。中身は後から入る。
    expect(pop()?.textContent).toContain("読み込み中");
    await act(async () => {});
    expect(pop()?.textContent).toContain("隣");
  });

  it("選んだ 1 枚へ切り替わる", async () => {
    level["/Users/me/Downloads"] = [file("/Users/me/Downloads/隣.md")];
    const at = show("/Users/me/Downloads/設計.md");
    click(crumbs(at).at(-1)!);
    await act(async () => {});
    const row = [...pop()!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("隣"),
    );
    click(row!);
    expect(opened).toEqual(["/Users/me/Downloads/隣.md"]);
  });

  it("木が無いので「ツリーで表示」は出さない", async () => {
    level["/Users/me/Downloads"] = [file("/Users/me/Downloads/隣.md")];
    const at = show("/Users/me/Downloads/設計.md");
    click(crumbs(at).at(-1)!);
    await act(async () => {});
    expect(pop()?.textContent).not.toContain("ツリーで表示");
  });
});

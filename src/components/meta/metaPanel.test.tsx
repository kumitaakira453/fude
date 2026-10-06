// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseFrontmatter } from "../../lib/frontmatter";
import { MetaPanel } from "./MetaPanel";

// 本文の上に出すメタ情報の表。読むためのもので、押すと編集の小窓を開く。

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: () => Promise.resolve() }));

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
});

function show(fm: string, onOpen = () => {}) {
  const { data, broken } = parseFrontmatter(`${fm}本文`);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<MetaPanel data={data} broken={broken} onOpen={onOpen} />));
  return host;
}

describe("本文の上のメタ情報", () => {
  it("鍵と値を表に並べ、並びは項目ごとに分ける", () => {
    const el = show("---\ntitle: 要件定義書\ndate: 2026-10-02\ntags:\n  - 仕様\n  - 連携\n---\n");
    const rows = Array.from(el.querySelectorAll("tr")).map((tr) => [
      tr.querySelector("th")?.textContent,
      tr.querySelector("td")?.textContent,
    ]);
    expect(rows).toEqual([
      ["title", "要件定義書"],
      ["date", "2026-10-02"],
      ["tags", "仕様連携"],
    ]);
    expect(el.querySelectorAll(".mg-meta-panel-item")).toHaveLength(2);
  });

  it("表を押すと編集の小窓を開く", () => {
    const open = vi.fn();
    const el = show("---\ntitle: a\n---\n", open);
    act(() => el.querySelector<HTMLElement>("table")!.click());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("メタ情報が無ければ何も出さない", () => {
    expect(show("").textContent).toBe("");
  });

  it("読めないときは、そう出して押せば直せるようにする", () => {
    const open = vi.fn();
    const el = show("---\n[1, 2]\n---\n", open);
    expect(el.textContent).toContain("メタ情報を読めません");
    act(() => el.querySelector<HTMLElement>(".mg-meta-panel-broken")!.click());
    expect(open).toHaveBeenCalledTimes(1);
  });
});

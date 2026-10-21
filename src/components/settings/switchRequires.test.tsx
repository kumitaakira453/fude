// @vitest-environment jsdom
import { atom, createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Switch } from "./SettingRow";
import type { SwitchRow } from "./rows";

// 入にするのに要るもの（D2 の図なら d2 コマンド）が無いときは、切のまま押せない。

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

const flag = atom(true);
const row = (ok: boolean): SwitchRow => ({
  kind: "switch",
  id: "d2",
  face: "look",
  group: "表示",
  name: "D2 の図を描く",
  note: "説明",
  atom: flag,
  requires: { check: async () => ok, missing: "d2 コマンドが見つかりません" },
});

async function show(ok: boolean) {
  const store = createStore();
  store.set(flag, true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Provider store={store}>
        <Switch row={row(ok)} />
      </Provider>,
    );
  });
  return { button: host.querySelector<HTMLButtonElement>('[role="switch"]')!, store };
}

describe("要るものがある切り替え", () => {
  it("無ければ切にして押せなくし、無い旨を添える", async () => {
    const { button, store } = await show(false);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-checked")).toBe("false");
    expect(store.get(flag)).toBe(false);
    expect(button.textContent).toContain("d2 コマンドが見つかりません");
  });

  it("あればそのまま切り替えられる", async () => {
    const { button, store } = await show(true);
    expect(button.disabled).toBe(false);
    expect(store.get(flag)).toBe(true);
    expect(button.textContent).not.toContain("見つかりません");
  });
});

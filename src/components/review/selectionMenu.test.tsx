// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SelectionAct, SelectionMenu } from "./SelectionMenu";

// 字を選んだときのメニュー。押した瞬間に選択が解けると、そのまま
// selectionchange でメニュー自身が消えて操作がどこにも届かない。
// だから click ではなく mousedown で受け、既定動作を止める。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom には大きさの見張りが無い。帯は自分の箱を測って置き場所を決める。
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

let root: Root | null = null;
let host: HTMLElement | null = null;

const press = (el: Element) => {
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event.defaultPrevented;
};

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function show(node: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

describe("選択メニュー", () => {
  it("コメントは押し下げで呼ばれ、選択を解かせない", () => {
    let asked = 0;
    const at = show(
      <SelectionMenu at={{ bottom: 100, left: 20 }} onComment={() => asked++} />,
    );
    const button = at.querySelector("button")!;
    expect(button.textContent).toContain("コメント");
    expect(press(button)).toBe(true);
    expect(asked).toBe(1);
  });

  it("選んだ範囲のすぐ下に出す", () => {
    const at = show(<SelectionMenu at={{ bottom: 100, left: 20 }} onComment={() => {}} />);
    const menu = at.querySelector<HTMLElement>(".mg-sel-menu")!;
    expect(menu.style.top).toBe("108px");
    expect(menu.style.left).toBe("20px");
  });

  it("画面ごとの操作は後ろに並ぶ", () => {
    let asked = 0;
    const at = show(
      <SelectionMenu at={{ bottom: 0, left: 0 }} onComment={() => {}}>
        <SelectionAct icon="edit" label="編集する" onPick={() => asked++} />
      </SelectionMenu>,
    );
    const buttons = [...at.querySelectorAll("button")];
    // アイコンの字（Material Symbols）が頭に入るので、末尾の言葉で見る
    expect(buttons.map((b) => b.textContent)).toEqual([
      "add_commentコメント",
      "edit編集する",
    ]);
    expect(press(buttons[1])).toBe(true);
    expect(asked).toBe(1);
  });
});

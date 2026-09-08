// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BlockMenu, type MenuItem } from "./BlockMenu";

// つまみや帯から出す小さなメニュー。横へ開く一覧と、押せない項目を押さえる。
//
// 横へ開く一覧は「外を押したら閉じる」に自分自身の押下を拾わせると、開いた
// 端から閉じる。実機では「見た目だけあって何も起きない」と出るので、開いた
// ままになっているかを試験で見る。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function open(items: MenuItem[], onClose = () => {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<BlockMenu x={10} y={10} items={items} onClose={onClose} />));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll(".mg-block-menu").forEach((el) => el.remove());
  root = null;
  host = null;
});

const menus = () => document.querySelectorAll(".mg-block-menu");
const row = (label: string): HTMLButtonElement => {
  const el = [...document.querySelectorAll<HTMLButtonElement>(".mg-block-menu button")].find(
    (b) => b.textContent?.includes(label),
  );
  expect(el, `${label} の項目が無い`).toBeDefined();
  return el!;
};

// 実機と同じ順で配る。押し下げは要素から window まで上がる（「外を押した」の
// 判定はそこで走る）ので、window へ別に配ってはいけない。
function press(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("横へ開く一覧", () => {
  const nested = (ran: string[]): MenuItem[] => [
    {
      icon: "sync_alt",
      label: "ブロックタイプの変換",
      items: [
        { icon: "text_fields", label: "テキスト", run: () => ran.push("テキスト") },
        {
          icon: "format_h2",
          label: "見出し 2",
          disabled: true,
          run: () => ran.push("見出し 2"),
        },
      ],
    },
    { icon: "delete", label: "削除", run: () => ran.push("削除") },
  ];

  it("押すと開き、開いたままになる", () => {
    open(nested([]));
    expect(menus()).toHaveLength(1);
    press(row("ブロックタイプの変換"));
    expect(menus()).toHaveLength(2);
  });

  it("選ぶと手が走り、親ごと閉じる", () => {
    const ran: string[] = [];
    let closed = 0;
    open(nested(ran), () => closed++);
    press(row("ブロックタイプの変換"));
    press(row("テキスト"));
    expect(ran).toEqual(["テキスト"]);
    expect(closed).toBe(1);
  });

  it("一覧を持つ項目そのものは何もしない", () => {
    const ran: string[] = [];
    let closed = 0;
    open(nested(ran), () => closed++);
    press(row("ブロックタイプの変換"));
    expect(ran).toEqual([]);
    expect(closed).toBe(0);
  });
});

describe("押せない項目", () => {
  it("押しても手は走らない", () => {
    const ran: string[] = [];
    open([
      {
        icon: "format_h2",
        label: "見出し 2",
        disabled: true,
        run: () => ran.push("見出し 2"),
      },
    ]);
    const el = row("見出し 2");
    expect(el.disabled).toBe(true);
    press(el);
    expect(ran).toEqual([]);
  });
});

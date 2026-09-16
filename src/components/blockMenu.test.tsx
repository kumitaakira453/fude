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

function open(
  items: MenuItem[],
  onClose = () => {},
  avoid?: { top: number; bottom: number },
  y = 10,
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <BlockMenu x={10} y={y} avoid={avoid} items={items} onClose={onClose} />,
    ),
  );
}

const topOf = (): number =>
  parseFloat(document.querySelector<HTMLElement>(".mg-block-menu")!.style.top);

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

// メニューは「何に対するものか」を塗って示す。その塗りを覆うと、何を選んだのか
// 読めなくなる（実機では選んだ項目がメニューの下に隠れていた）。
describe("相手を隠さない置き場所", () => {
  const three: MenuItem[] = [
    { icon: "a", label: "ひとつ", run: () => {} },
    { icon: "b", label: "ふたつ", run: () => {} },
    { icon: "c", label: "みっつ", run: () => {} },
  ];

  it("相手の下に出す", () => {
    open(three, () => {}, { top: 100, bottom: 140 }, 110);
    // 押した高さ（110）ではなく、相手の下（140 + 隙間）へ
    expect(topOf()).toBe(148);
  });

  it("下に入らなければ上へ逃がす", () => {
    const tall = window.innerHeight; // jsdom は 768
    open(three, () => {}, { top: tall - 60, bottom: tall - 20 }, tall - 30);
    // 3 行ぶん（32 * 3 + 20 = 116）と隙間の分だけ上へ
    expect(topOf()).toBe(tall - 60 - 8 - 116);
  });

  it("メニューより背の高い相手なら押した高さのまま", () => {
    // 覆っても上下に余りが出るので、遠くへ動かすより近くに出す方がよい。
    open(three, () => {}, { top: 100, bottom: 500 }, 120);
    expect(topOf()).toBe(120);
  });

  it("相手が渡されなければ押した高さに出す", () => {
    open(three, () => {}, undefined, 50);
    expect(topOf()).toBe(50);
  });

  it("画面の上へははみ出さない（背の高い相手でも）", () => {
    // 絵のように背の高い塊を、画面の上の方で押したとき。
    open(three, () => {}, { top: -200, bottom: 400 }, -120);
    expect(topOf()).toBe(8);
  });

  it("画面の下へもはみ出さない", () => {
    const tall = window.innerHeight;
    open(three, () => {}, { top: -200, bottom: tall + 200 }, tall - 10);
    // 3 行ぶん（116）と余白が入る高さまでで止める。
    expect(topOf()).toBe(tall - 116 - 8);
  });
});

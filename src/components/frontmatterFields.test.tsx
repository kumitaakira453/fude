// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FrontmatterFields } from "./FrontmatterFields";

// 書くときのフロントマター。鍵も値も素の contenteditable に置いてあり、React は
// 中身を持たない。ここで押さえるのは「打っても塗り直されないこと」「行を
// 組み替えてもカーソルが残ること」「本文との行き来」。

const FM = ["---", "title: 題", "種別: 新規依頼", "依頼日: '2026-09-02'", "---", ""].join(
  "\n",
);

// 並びを持つフロントマター。
const LIST = ["---", "案:", "- 一つ", "- 二つ", "---", ""].join("\n");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
// 片付けの最中は描き直さない（部品は外れるときに書きかけを流す）。
let live = true;

afterEach(() => {
  live = false;
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

interface Rig {
  cells: () => HTMLElement[];
  text: () => (string | null)[];
  wrote: string[];
  now: () => string;
  out: () => number;
  enter: { current: (() => void) | null };
  again: (fm: string) => void;
  plus: () => HTMLElement | null;
  add: () => HTMLElement | null;
  gone: () => HTMLElement[];
}

// 親は書き込んだものをそのまま返す。実物と同じ回り方にしておかないと、
// 組み替えた直後に古い fm で描き直されてしまう。
function rig(fm = FM): Rig {
  const wrote: string[] = [];
  let left = 0;
  let held = fm;
  live = true;
  const enter: { current: (() => void) | null } = { current: null };

  const made = (text: string) => (
    <FrontmatterFields
      fm={text}
      name="めも"
      onChange={(next) => {
        wrote.push(next);
        held = next;
        if (live) root!.render(made(next));
      }}
      onOut={() => left++}
      enterRef={enter}
    />
  );

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(made(fm)));

  const cells = () => [...host!.querySelectorAll<HTMLElement>(".mg-fm-cell")];
  return {
    cells,
    text: () => cells().map((el) => el.textContent),
    wrote,
    now: () => held,
    out: () => left,
    enter,
    again: (text) => {
      held = text;
      act(() => root!.render(made(text)));
    },
    plus: () => host!.querySelector<HTMLElement>(".mg-fm-plus"),
    add: () => host!.querySelector<HTMLElement>(".mg-fm-add"),
    gone: () => [...host!.querySelectorAll<HTMLElement>(".mg-fm-gone")],
  };
}

// 欄に打つ。素の contenteditable なので、DOM を書いてから合図を出す。
function type(el: HTMLElement, text: string) {
  el.textContent = text;
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// 焦点が外れたとき（保存を待たずに流す）。
function leave(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

const key = (
  el: HTMLElement,
  k: string,
  mod: { shift?: boolean; alt?: boolean } = {},
) =>
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: k,
        shiftKey: !!mod.shift,
        altKey: !!mod.alt,
        bubbles: true,
      }),
    );
  });

const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

describe("欄の並び", () => {
  it("題は値だけ、その他は鍵と値が並ぶ", () => {
    expect(rig().text()).toEqual(["題", "種別", "新規依頼", "依頼日", "2026-09-02"]);
  });

  it("並びは項目ごとに欄になる", () => {
    expect(rig(LIST).text()).toEqual(["案", "一つ", "二つ"]);
  });
});

describe("打つ", () => {
  it("値を打つと、その行だけが変わった生テキストが届く", () => {
    const r = rig();
    type(r.cells()[2], "修正依頼");
    leave(r.cells()[2]);
    expect(r.wrote.at(-1)).toBe(
      ["---", "title: 題", "種別: 修正依頼", "依頼日: '2026-09-02'", "---", ""].join(
        "\n",
      ),
    );
  });

  it("鍵を打つと、鍵だけが変わる", () => {
    const r = rig();
    type(r.cells()[1], "区分");
    leave(r.cells()[1]);
    expect(r.wrote.at(-1)).toContain("区分: 新規依頼");
    expect(r.wrote.at(-1)).not.toContain("種別");
  });

  it("続けて打っても範囲がずれない", () => {
    const r = rig();
    type(r.cells()[1], "ずっと長い鍵の名前");
    type(r.cells()[4], "2026-12-31");
    leave(r.cells()[4]);
    expect(r.wrote.at(-1)).toBe(
      [
        "---",
        "title: 題",
        "ずっと長い鍵の名前: 新規依頼",
        "依頼日: '2026-12-31'",
        "---",
        "",
      ].join("\n"),
    );
  });

  it("引用符付きの値は引用符のまま保たれる", () => {
    const r = rig();
    type(r.cells()[4], "2026-12-31");
    leave(r.cells()[4]);
    expect(r.wrote.at(-1)).toContain("依頼日: '2026-12-31'");
  });

  it("打っている最中は、外からの描き直しで欄が戻らない", () => {
    const r = rig();
    const cell = r.cells()[2];
    cell.focus();
    type(cell, "打ちかけ");
    r.again(FM.replace("種別: 新規依頼", "種別: 外で変えた"));
    expect(r.cells()[2].textContent).toBe("打ちかけ");
  });

  it("焦点が無いときは外の変更を取り込む", () => {
    const r = rig();
    r.again(FM.replace("種別: 新規依頼", "種別: 外で変えた"));
    expect(r.cells()[2].textContent).toBe("外で変えた");
  });
});

describe("欄を足す・消す", () => {
  it("+ で欄が増え、鍵を選んだ状態でカーソルが入る", () => {
    const r = rig();
    click(r.plus()!);
    expect(r.text()).toEqual([
      "題",
      "種別",
      "新規依頼",
      "依頼日",
      "2026-09-02",
      "項目",
      "",
    ]);
    expect(document.activeElement?.textContent).toBe("項目");
    expect(window.getSelection()?.isCollapsed).toBe(false);
  });

  it("足した鍵はそのまま打ち替えられる", () => {
    const r = rig();
    click(r.plus()!);
    const at = document.activeElement as HTMLElement;
    type(at, "担当");
    leave(at);
    expect(r.now()).toContain("担当:");
    expect(r.now()).not.toContain("項目");
  });

  it("重なる鍵は番号を付けて避ける", () => {
    const r = rig();
    click(r.plus()!);
    click(r.plus()!);
    expect(r.text().slice(-4)).toEqual(["項目", "", "項目 2", ""]);
  });

  it("× で欄ごと消える", () => {
    const r = rig();
    // 題・種別・依頼日 の順に × が並ぶ。
    click(r.gone()[1]);
    expect(r.text()).toEqual(["題", "依頼日", "2026-09-02"]);
    expect(r.now()).not.toContain("新規依頼");
  });

  it("空の鍵で Backspace を押すと消える", () => {
    const r = rig();
    const at = r.cells()[1];
    at.focus();
    type(at, "");
    key(at, "Backspace");
    expect(r.text()).toEqual(["題", "依頼日", "2026-09-02"]);
  });

  it("最後の欄を消すと、フロントマターそのものが消える", () => {
    const r = rig("---\nmemo: ひとつ\n---\n");
    click(r.gone()[0]);
    expect(r.now()).toBe("");
    expect(r.add()).not.toBe(null);
  });
});

describe("並びの項目", () => {
  it("項目の中で Enter を押すと、下に項目が増える", () => {
    const r = rig(LIST);
    const at = r.cells()[1];
    at.focus();
    key(at, "Enter");
    expect(r.text()).toEqual(["案", "一つ", "", "二つ"]);
    expect(document.activeElement).toBe(r.cells()[2]);
  });

  it("空の項目で Backspace を押すと消える", () => {
    const r = rig(LIST);
    const at = r.cells()[2];
    at.focus();
    type(at, "");
    key(at, "Backspace");
    expect(r.text()).toEqual(["案", "一つ"]);
  });

  it("scalar の Enter は今までどおり次の欄へ", () => {
    const r = rig();
    r.cells()[1].focus();
    key(r.cells()[1], "Enter");
    expect(document.activeElement).toBe(r.cells()[2]);
  });
});

describe("並べ替え", () => {
  it("⌥↓ で欄が下がり、カーソルは付いていく", () => {
    const r = rig();
    const at = r.cells()[1];
    at.focus();
    key(at, "ArrowDown", { alt: true });
    expect(r.text()).toEqual(["題", "依頼日", "2026-09-02", "種別", "新規依頼"]);
    expect(document.activeElement?.textContent).toBe("種別");
  });

  it("⌥↑ で欄が上がる", () => {
    const r = rig();
    const at = r.cells()[3];
    at.focus();
    key(at, "ArrowUp", { alt: true });
    expect(r.text()).toEqual(["題", "依頼日", "2026-09-02", "種別", "新規依頼"]);
  });

  it("端では動かない", () => {
    const r = rig();
    const at = r.cells()[1];
    at.focus();
    key(at, "ArrowUp", { alt: true });
    expect(r.text()).toEqual(["題", "種別", "新規依頼", "依頼日", "2026-09-02"]);
  });

  it("並びの項目にいるときは、その項目が動く", () => {
    const r = rig(LIST);
    const at = r.cells()[1];
    at.focus();
    key(at, "ArrowDown", { alt: true });
    expect(r.text()).toEqual(["案", "二つ", "一つ"]);
    expect(document.activeElement).toBe(r.cells()[2]);
  });
});

describe("何も無いファイル", () => {
  it("入口だけが出る", () => {
    const r = rig("");
    expect(r.cells()).toEqual([]);
    expect(r.add()).not.toBe(null);
  });

  it("押すとファイル名を題にして付く。題は選ばれた状態", () => {
    const r = rig("");
    click(r.add()!);
    expect(r.now()).toBe("---\ntitle: めも\n---\n\n");
    expect(document.activeElement?.textContent).toBe("めも");
    expect(window.getSelection()?.isCollapsed).toBe(false);
  });
});

describe("欄と本文の行き来", () => {
  it("Tab で次の欄、Shift-Tab で前の欄へ", () => {
    const r = rig();
    r.cells()[0].focus();
    key(r.cells()[0], "Tab");
    expect(document.activeElement).toBe(r.cells()[1]);
    key(r.cells()[1], "Tab", { shift: true });
    expect(document.activeElement).toBe(r.cells()[0]);
  });

  it("最後の欄で ↓ を押すと本文へ抜ける", () => {
    const r = rig();
    const last = r.cells()[4];
    last.focus();
    key(last, "ArrowDown");
    expect(r.out()).toBe(1);
  });

  it("途中の欄の ↓ は次の欄へ。本文へは抜けない", () => {
    const r = rig();
    r.cells()[0].focus();
    key(r.cells()[0], "ArrowDown");
    expect(document.activeElement).toBe(r.cells()[1]);
    expect(r.out()).toBe(0);
  });

  it("最初の欄の ↑ では何も起きない", () => {
    const r = rig();
    r.cells()[0].focus();
    key(r.cells()[0], "ArrowUp");
    expect(document.activeElement).toBe(r.cells()[0]);
    expect(r.out()).toBe(0);
  });

  it("Esc で本文へ戻る", () => {
    const r = rig();
    r.cells()[1].focus();
    key(r.cells()[1], "Escape");
    expect(r.out()).toBe(1);
  });

  it("本文から戻ってくると、末尾の欄に入る", () => {
    const r = rig();
    act(() => r.enter.current?.());
    expect(document.activeElement).toBe(r.cells()[4]);
  });
});

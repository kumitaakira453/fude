// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaModal } from "./MetaModal";

// メタ情報の小窓。鍵も値も素の contenteditable に置いてあり、React は中身を
// 持たない。ここで押さえるのは「打っても塗り直されないこと」「行を組み替えても
// カーソルが残ること」「値の種類ごとの操作」。

const FM = ["---", "title: 題", "種別: 新規依頼", "依頼日: '2026-09-02'", "---", ""].join(
  "\n",
);

// 並びを持つメタ情報。
const LIST = ["---", "案:", "- 一つ", "- 二つ", "---", ""].join("\n");

const opened: string[] = [];
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => {
    opened.push(url);
    return Promise.resolve();
  },
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
// 片付けの最中は描き直さない（部品は外れるときに書きかけを流す）。
let live = true;

beforeEach(() => {
  opened.length = 0;
});

afterEach(() => {
  live = false;
  act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll(".mg-meta-back").forEach((n) => n.remove());
  root = null;
  host = null;
});

interface Rig {
  cells: () => HTMLElement[];
  text: () => (string | null)[];
  rows: () => HTMLElement[];
  wrote: string[];
  now: () => string;
  closed: () => number;
  again: (fm: string) => void;
  add: () => HTMLElement | null;
  acts: (row: number) => HTMLElement[];
}

// 親は書き込んだものをそのまま返す。実物と同じ回り方にしておかないと、
// 組み替えた直後に古い fm で描き直されてしまう。
function rig(fm = FM, broken = false): Rig {
  const wrote: string[] = [];
  let shut = 0;
  let held = fm;
  live = true;

  const made = (text: string) => (
    <MetaModal
      name="めも.md"
      fm={text}
      broken={broken}
      onChange={(next) => {
        wrote.push(next);
        held = next;
        if (live) root!.render(made(next));
      }}
      onClose={() => shut++}
    />
  );

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(made(fm)));

  const at = () => document.querySelector<HTMLElement>(".mg-meta")!;
  const cells = () => [
    ...at().querySelectorAll<HTMLElement>(".mg-meta-key, .mg-meta-cell"),
  ];
  return {
    cells,
    text: () => cells().map((el) => el.textContent),
    rows: () => [...at().querySelectorAll<HTMLElement>(".mg-meta-row")],
    wrote,
    now: () => held,
    closed: () => shut,
    again: (text) => {
      held = text;
      act(() => root!.render(made(text)));
    },
    add: () => at().querySelector<HTMLElement>(".mg-meta-add"),
    acts: (row) => [
      ...at()
        .querySelectorAll<HTMLElement>(".mg-meta-row")
        [row].querySelectorAll<HTMLElement>(".mg-meta-acts button"),
    ],
  };
}

function type(el: HTMLElement, text: string) {
  el.textContent = text;
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

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

describe("並び", () => {
  it("鍵と値が行ごとに並ぶ", () => {
    expect(rig().text()).toEqual([
      "title",
      "題",
      "種別",
      "新規依頼",
      "依頼日",
      "2026-09-02",
    ]);
  });

  it("題も他の鍵と同じ 1 行として出す（本文には出さない）", () => {
    expect(rig().rows().length).toBe(3);
  });

  it("並びは項目ごとに欄になる", () => {
    expect(rig(LIST).text()).toEqual(["案", "一つ", "二つ"]);
  });
});

describe("打つ", () => {
  it("値を打つと、その行だけが変わった生テキストが届く", () => {
    const r = rig();
    type(r.cells()[3], "修正依頼");
    leave(r.cells()[3]);
    expect(r.wrote.at(-1)).toBe(
      ["---", "title: 題", "種別: 修正依頼", "依頼日: '2026-09-02'", "---", ""].join(
        "\n",
      ),
    );
  });

  it("鍵を打つと、鍵だけが変わる", () => {
    const r = rig();
    type(r.cells()[2], "区分");
    leave(r.cells()[2]);
    expect(r.wrote.at(-1)).toContain("区分: 新規依頼");
    expect(r.wrote.at(-1)).not.toContain("種別");
  });

  it("引用符付きの値は引用符のまま保たれる", () => {
    const r = rig();
    type(r.cells()[5], "2026-12-31");
    leave(r.cells()[5]);
    expect(r.wrote.at(-1)).toContain("依頼日: '2026-12-31'");
  });

  it("打っている最中は、外からの描き直しで欄が戻らない", () => {
    const r = rig();
    const cell = r.cells()[3];
    cell.focus();
    type(cell, "打ちかけ");
    r.again(FM.replace("種別: 新規依頼", "種別: 外で変えた"));
    expect(r.cells()[3].textContent).toBe("打ちかけ");
  });

  it("焦点が無いときは外の変更を取り込む", () => {
    const r = rig();
    r.again(FM.replace("種別: 新規依頼", "種別: 外で変えた"));
    expect(r.cells()[3].textContent).toBe("外で変えた");
  });
});

describe("値の種類", () => {
  it("URL の行には開く釦が出て、押すと外で開く", () => {
    const r = rig(["---", "url: https://example.com", "---", ""].join("\n"));
    const acts = r.acts(0);
    // 開く釦と、消す釦。
    expect(acts.length).toBe(2);
    expect(acts[0].title).toBe("開く");
    click(acts[0]);
    expect(opened).toEqual(["https://example.com"]);
  });

  it("ただの字の行には開く釦を出さない", () => {
    const r = rig(["---", "memo: ただの字", "---", ""].join("\n"));
    expect(r.acts(0).map((b) => b.title)).toEqual(["「memo」を消す"]);
  });

  it("宛先の行は送る釦になる", () => {
    const r = rig(["---", "to: a@example.com", "---", ""].join("\n"));
    click(r.acts(0)[0]);
    expect(opened).toEqual(["mailto:a@example.com"]);
  });
});

describe("行を足す・消す", () => {
  it("＋ で行が増え、鍵を選んだ状態でカーソルが入る", () => {
    const r = rig();
    click(r.add()!);
    expect(r.text().slice(-2)).toEqual(["項目", ""]);
    expect(document.activeElement?.textContent).toBe("項目");
    expect(window.getSelection()?.isCollapsed).toBe(false);
  });

  it("× で行ごと消える", () => {
    const r = rig();
    click(r.acts(1).at(-1)!);
    expect(r.text()).toEqual(["title", "題", "依頼日", "2026-09-02"]);
    expect(r.now()).not.toContain("新規依頼");
  });

  it("空の鍵で Backspace を押すと消える", () => {
    const r = rig();
    const at = r.cells()[2];
    at.focus();
    type(at, "");
    key(at, "Backspace");
    expect(r.text()).toEqual(["title", "題", "依頼日", "2026-09-02"]);
  });

  it("最後の行を消すと、メタ情報そのものが消える", () => {
    const r = rig("---\nmemo: ひとつ\n---\n");
    click(r.acts(0).at(-1)!);
    expect(r.now()).toBe("");
    expect(r.add()?.textContent).toContain("最初の項目を追加");
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
});

describe("並べ替え", () => {
  it("⌥↓ で行が下がり、カーソルは付いていく", () => {
    const r = rig();
    const at = r.cells()[2];
    at.focus();
    key(at, "ArrowDown", { alt: true });
    expect(r.text()).toEqual([
      "title",
      "題",
      "依頼日",
      "2026-09-02",
      "種別",
      "新規依頼",
    ]);
    expect(document.activeElement?.textContent).toBe("種別");
  });

  it("端では動かない", () => {
    const r = rig();
    const at = r.cells()[0];
    at.focus();
    key(at, "ArrowUp", { alt: true });
    expect(r.text()[0]).toBe("title");
  });

  it("並びの項目にいるときは、その項目が動く", () => {
    const r = rig(LIST);
    const at = r.cells()[1];
    at.focus();
    key(at, "ArrowDown", { alt: true });
    expect(r.text()).toEqual(["案", "二つ", "一つ"]);
  });
});

describe("行き来と閉じる", () => {
  it("Tab で次の欄、Shift-Tab で前の欄へ", () => {
    const r = rig();
    r.cells()[0].focus();
    key(r.cells()[0], "Tab");
    expect(document.activeElement).toBe(r.cells()[1]);
    key(r.cells()[1], "Tab", { shift: true });
    expect(document.activeElement).toBe(r.cells()[0]);
  });

  it("最後の欄の先では抜けない（小窓の中で完結する）", () => {
    const r = rig();
    const last = r.cells().at(-1)!;
    last.focus();
    key(last, "ArrowDown");
    expect(document.activeElement).toBe(last);
  });

  it("Esc で閉じる", () => {
    const r = rig();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(r.closed()).toBe(1);
  });
});

describe("何も無いとき・読めないとき", () => {
  it("何も無ければ入口だけを出す", () => {
    const r = rig("");
    expect(r.cells()).toEqual([]);
    expect(r.add()?.textContent).toContain("最初の項目を追加");
  });

  it("押すと行が 1 つ増える", () => {
    const r = rig("");
    click(r.add()!);
    expect(r.now()).toBe("---\n項目:\n---\n\n");
    expect(r.text()).toEqual(["項目", ""]);
  });

  it("読めないときは断り書きと生の字を出す", () => {
    const r = rig("---\nただの字\n---\n", true);
    expect(document.querySelector(".mg-meta")?.textContent).toContain("読めません");
    expect(r.cells()).toEqual([]);
  });
});

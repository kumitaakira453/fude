// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "../lib/md/fromMarkdown";
import { editorPlugins } from "../lib/md/plugins";
import { toMarkdown } from "../lib/md/toMarkdown";
import { SelectionBar } from "./SelectionBar";

// 選んだ文字に出す帯。押して何かが「出る」ものを押さえる。
//
// ブロックの種別を出すメニューは、押し下げで出すと自分が付けた「外を押したら
// 閉じる」（mousedown を見ている）に、まだ配り終えていないその押下を拾われて
// 出た端から閉じる。実機では「見た目だけあって何も起きない」と出るので、
// 出たかどうかを試験で見る。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const noRects = () => [] as unknown as DOMRectList;
  const noRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = noRects;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = noRect;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let open: { view: EditorView; place: HTMLElement; loaded: Loaded } | null = null;

// 最初の文字塊の中身が始まる位置。表のように入れ子が深いものでも、
// 「表示文字の何文字目」で選べるようにする。
function textStart(doc: EditorState["doc"]): number {
  let at = -1;
  doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isTextblock) at = pos + 1;
    return at < 0;
  });
  return at < 0 ? 1 : at;
}

// 本文を開いて from..to（表示文字の位置）を選び、その選択に帯を出す。
function bar(body: string, from: number, to: number) {
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({
      doc: loaded.doc,
      plugins: editorPlugins({ onSave: () => {} }),
    }),
  });
  const base = textStart(view.state.doc);
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, base + from, base + to),
    ),
  );
  open = { view, place, loaded };

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <SelectionBar
        view={view}
        at={{ top: 100, bottom: 120, left: 40 }}
        span={{ from: base + from, to: base + to }}
        linkNonce={0}
        onComment={() => {}}
      />,
    ),
  );
  return view;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  open?.view.destroy();
  open?.place.remove();
  document.querySelectorAll(".mg-block-menu").forEach((el) => el.remove());
  root = null;
  host = null;
  open = null;
});

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);
const button = (label: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
  expect(el, `${label} のボタンが無い`).not.toBeNull();
  return el!;
};

// 実機と同じ順で配る。React は押し下げで受け、その後 window まで上がる。
function pressDown(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });
}

function pressClick(el: HTMLElement) {
  pressDown(el);
  act(() => {
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const menu = () => document.querySelector(".mg-block-menu");
const field = () => document.querySelector<HTMLInputElement>(".mg-ask > input");

// React は value の書き込みを自分で見張っているので、素の代入では onChange が
// 走らない。本来の setter を呼んでから input を配る。
const nativeValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;

function fill(text: string) {
  const input = field()!;
  act(() => {
    nativeValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
}

describe("ブロックの種別", () => {
  it("押すとメニューが出て、開いたままになる", () => {
    bar("ここを変える\n", 2, 4);
    expect(menu()).toBeNull();
    pressClick(button("ブロックの種別"));
    expect(menu()).not.toBeNull();
  });

  it("選んだ種別に変わる", () => {
    bar("ここを変える\n", 2, 4);
    pressClick(button("ブロックの種別"));
    // アイコンは合字なので、名前より前に字が入る。含みで探す。
    const item = [...menu()!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("見出し 2"),
    );
    expect(item).toBeDefined();
    act(() => item!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(source()).toBe("## ここを変える\n");
    expect(menu()).toBeNull();
  });

  it("入れるだけのもの（表・区切り線・絵文字）は出さない", () => {
    bar("ここを変える\n", 2, 4);
    pressClick(button("ブロックの種別"));
    const labels = [...menu()!.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(labels.some((one) => one.includes("テキスト"))).toBe(true);
    expect(labels.some((one) => one.includes("引用"))).toBe(true);
    expect(labels.some((one) => one.includes("テーブル"))).toBe(false);
    expect(labels.some((one) => one.includes("区切り線"))).toBe(false);
  });

  it("表のセルの中では出さない", () => {
    bar("| あい | b |\n| --- | --- |\n| 1 | 2 |\n", 0, 2);
    expect(document.querySelector('button[aria-label="ブロックの種別"]')).toBeNull();
    expect(document.querySelector('button[aria-label="コメント"]')).not.toBeNull();
  });
});

describe("並べ方", () => {
  const labels = (row: Element) =>
    [...row.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));

  it("種別とコメントは段を丸ごと使い、装飾は 4 つずつ 2 段", () => {
    bar("ここを変える\n", 2, 4);
    const rows = [...document.querySelectorAll(".mg-sel-row")];
    expect(rows.map(labels)).toEqual([
      ["太字", "斜体", "下線", "書式をクリア"],
      ["リンク", "取り消し線", "行内コード", "式"],
    ]);
    // 段の中ではなく、帯の直下に置く。
    for (const one of ["ブロックの種別", "コメント"]) {
      expect(button(one).closest(".mg-sel-row")).toBeNull();
    }
  });
});

describe("リンク", () => {
  it("押すと行き先を聞く欄が出て、Enter で張る", () => {
    bar("ここを見る\n", 0, 2);
    expect(field()).toBeNull();
    pressDown(button("リンク"));
    expect(field()).not.toBeNull();
    fill("https://example.com");
    expect(source()).toBe("[ここ](https://example.com)を見る\n");
    expect(field()).toBeNull();
  });

  // 出した押下で閉じてはいけない。押している間しか出ていないように見える。
  //
  // 押し下げは要素から window まで上がるので、欄を出したその押下も、付いた
  // 直後の聞き手へ届くことがある。届く / 届かないは React が効果を流す番に
  // よるので、両方を配って確かめる。
  it("押して離しただけでは閉じない", () => {
    bar("ここを見る\n", 0, 2);
    const el = button("リンク");
    pressDown(el);
    expect(field()).not.toBeNull();
    act(() => {
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    act(() => {
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    });
    expect(field()).not.toBeNull();
  });

  it("外で押して離したら閉じる", async () => {
    bar("ここを見る\n", 0, 2);
    pressDown(button("リンク"));
    expect(field()).not.toBeNull();
    // 出した押下と見分けるため、数え始めるのは次の番から。
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    });
    expect(field()).toBeNull();
  });

  it("既にリンクなら押すと外れ、欄は出さない", () => {
    bar("[ここ](https://example.com)を見る\n", 0, 2);
    pressDown(button("リンク"));
    expect(field()).toBeNull();
    expect(source()).toBe("ここを見る\n");
  });
});

describe("式", () => {
  it("押すと選んだ文字が入った欄が出て、Enter で式になる", () => {
    bar("計算は E = mc^2 です\n", 4, 12);
    pressDown(button("式"));
    expect(field()?.value).toBe("E = mc^2");
    fill("E = mc^2");
    expect(source()).toBe("計算は $E = mc^2$ です\n");
  });

  it("式を選んで押すと打ち直しになる", () => {
    bar("文中の $a^2$ と\n", 4, 5);
    pressDown(button("式"));
    expect(field()?.value).toBe("a^2");
    fill("b^2");
    expect(source()).toBe("文中の $b^2$ と\n");
  });
});

describe("装飾", () => {
  it("押した装飾が付き、押し込んで見せる", () => {
    bar("ここを太く\n", 0, 2);
    pressDown(button("太字"));
    expect(source()).toBe("**ここ**を太く\n");
    expect(button("太字").className).toContain("is-on");
  });

  it("押しても帯の位置は動かない（選んでいるところが同じなら）", () => {
    bar("ここを太く\n", 0, 2);
    const where = () => document.querySelector<HTMLElement>(".mg-sel-bar")!.style.top;
    const before = where();
    pressDown(button("斜体"));
    expect(where()).toBe(before);
  });

  it("書式クリアで全部落ちる", () => {
    bar("**ふとい**と*ななめ*\n", 0, 7);
    pressDown(button("書式をクリア"));
    expect(source()).toBe("ふといとななめ\n");
  });
});

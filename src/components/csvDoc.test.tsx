// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { csvFiltersAtom, csvViewAtom, csvWidthsAtom } from "../state/atoms";
import { CsvDoc } from "./CsvDoc";

// CSV は列ごとの色の原文で開き、釦で表に替わる。表では 1 行目をヘッダー行に置く。

let content = '名前,点\n"山田, 太郎",90\n鈴木,80\n';
const written: string[] = [];
vi.mock("../lib/fsAccess", () => ({
  readText: async () => content,
  writeFile: async (_abs: string, text: string) => {
    written.push(text);
  },
}));

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
  content = '名前,点\n"山田, 太郎",90\n鈴木,80\n';
  written.length = 0;
});

async function show() {
  const store = createStore();
  // 見た目は保存領域に残るので、試験ごとに原文の見た目から始める。
  store.set(csvViewAtom, "rainbow");
  store.set(csvWidthsAtom, {});
  store.set(csvFiltersAtom, {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Provider store={store}>
        <CsvDoc abs="/本/表.csv" />
      </Provider>,
    );
  });
  return { el: host, store };
}

// 同じ店のまま、別の道筋のファイルに替える（タブを替えて戻る）。
async function reopen(store: ReturnType<typeof createStore>, abs: string) {
  await act(async () => {
    root!.render(
      <Provider store={store}>
        <CsvDoc abs={abs} />
      </Provider>,
    );
  });
}

const button = (el: HTMLElement) => el.querySelector<HTMLButtonElement>(".mg-imgdoc-bar button")!;

describe("CSV を読む", () => {
  it("開くと、列ごとに色を付けた原文で出る", async () => {
    const { el } = await show();
    expect(el.querySelector("table")).toBeNull();
    const first = el.querySelector(".mg-source-line")!;
    expect([...first.querySelectorAll("[class^=mg-csv-c]")].map((s) => s.className)).toEqual([
      "mg-csv-c0",
      "mg-csv-c1",
    ]);
    expect(el.querySelector(".mg-imgdoc-size")!.textContent).toBe("CSV · 3 行 × 2 列");
    expect(button(el).textContent).toBe("表で見る");
  });

  it("釦で表に替わり、1 行目はヘッダー行、囲みの中のカンマは値の一部", async () => {
    const { el, store } = await show();
    act(() => button(el).click());
    expect(store.get(csvViewAtom)).toBe("table");
    const head = [...el.querySelectorAll(".mg-csv-head th:not(.mg-csv-no)")].map((c) => c.textContent);
    expect(head).toEqual(["名前", "点"]);
    const cells = [...el.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((c) => c.textContent),
    );
    expect(cells).toEqual([
      ["山田, 太郎", "90"],
      ["鈴木", "80"],
    ]);
    // 列の名前と行番号は字として置かない。
    expect(el.querySelector(".mg-csv-letters")!.textContent).toBe("");
    act(() => button(el).click());
    expect(el.querySelector("table")).toBeNull();
  });
});

describe("表の升目", () => {
  const table = async () => {
    const shown = await show();
    act(() => button(shown.el).click());
    return shown.el;
  };

  it("1 行おきに地を変える（表の中の位置で数える）", async () => {
    const el = await table();
    expect([...el.querySelectorAll("tbody tr")].map((tr) => tr.className)).toEqual(["", "is-even"]);
  });

  it("押しただけでは小窓を出さず、選んで ⌘Enter で全文を出す。JSON は字下げする", async () => {
    content = 'ログ\n"{""a"":1,\n""b"":[2]}"\n';
    const el = await table();
    const cell = el.querySelector("tbody td")!;
    act(() => {
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector(".mg-csv-peek")).toBeNull();
    expect(cell.classList.contains("is-sel")).toBe(true);
    const t = el.querySelector("table")!;
    const press = (key: string, metaKey = false) =>
      act(() => {
        t.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey, bubbles: true, cancelable: true }));
      });
    press("Enter", true);
    const peek = document.querySelector(".mg-csv-peek")!;
    expect(peek.querySelector(".mg-csv-peek-body")!.textContent).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
    expect(peek.textContent).toContain("A2 · JSON");
    expect(peek.querySelector("button")!.textContent).toBe("コピー");
    // Esc は小窓だけを閉じ、選択は残す。
    press("Escape");
    expect(document.querySelector(".mg-csv-peek")).toBeNull();
    expect(cell.classList.contains("is-sel")).toBe(true);
    // もう一度 ⌘Enter で出し、⌘Enter で閉じる。
    press("Enter", true);
    expect(document.querySelector(".mg-csv-peek")).not.toBeNull();
    press("Enter", true);
    expect(document.querySelector(".mg-csv-peek")).toBeNull();
  });
});

describe("升目の選択と列の幅", () => {
  const table = async () => {
    const shown = await show();
    act(() => button(shown.el).click());
    return shown;
  };
  const key = (el: Element, k: string) =>
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    });
  const selected = (el: HTMLElement) => {
    const c = el.querySelector<HTMLElement>(".is-sel");
    return c && `${c.dataset.r},${c.dataset.c}`;
  };

  it("押した升目を選び、矢印で上下左右へ動かす。端では止まる", async () => {
    const { el } = await table();
    act(() => {
      el.querySelector("tbody td")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const t = el.querySelector("table")!;
    expect(selected(el)).toBe("1,0");
    key(t, "ArrowRight");
    expect(selected(el)).toBe("1,1");
    key(t, "ArrowRight");
    expect(selected(el)).toBe("1,1");
    key(t, "ArrowDown");
    expect(selected(el)).toBe("2,1");
    key(t, "ArrowUp");
    key(t, "ArrowUp");
    // ヘッダー行（0 行目）まで上がれる。
    expect(selected(el)).toBe("0,1");
    key(t, "Escape");
    expect(selected(el)).toBeNull();
  });

  it("小窓を出したまま矢印で動かすと、小窓も動いた先の升目の全文になる", async () => {
    content = 'a,b\n1,"x\ny"\n';
    const { el } = await table();
    act(() => {
      el.querySelector("tbody td")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const t = el.querySelector("table")!;
    act(() => {
      t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
    });
    const body = () => document.querySelector(".mg-csv-peek-body")!.textContent;
    expect(body()).toBe("1");
    key(t, "ArrowRight");
    expect(body()).toBe("x\ny");
    expect(selected(el)).toBe("1,1");
  });

  it("つまみで列の幅を変えるとファイルごとに覚え、2 度押すと戻す", async () => {
    const { el, store } = await table();
    const col = () => el.querySelectorAll<HTMLElement>("col")[1].style.width;
    const before = col();
    const grip = el.querySelector(".mg-csv-grip")!;
    act(() => {
      grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100 }));
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 250 }));
      window.dispatchEvent(new MouseEvent("mouseup", {}));
    });
    expect(col()).toBe(`${parseInt(before) + 150}px`);
    expect(store.get(csvWidthsAtom)["/本/表.csv"]).toEqual({ 0: parseInt(before) + 150 });
    act(() => {
      grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(col()).toBe(before);
    expect(store.get(csvWidthsAtom)["/本/表.csv"]).toBeUndefined();
  });
});

// 見出しの ▽ から、列ごとに絞り込み・並べ替える（Excel のオートフィルタ）。
describe("列ごとの絞り込み", () => {
  const SALES = "名前,部署,金額\n佐藤,営業,1200\n鈴木,開発,300\n高橋,営業,45\n";
  const key = (el: Element, k: string) =>
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    });
  const table = async () => {
    content = SALES;
    const shown = await show();
    act(() => button(shown.el).click());
    return shown;
  };
  const names = (el: HTMLElement) =>
    [...el.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td")?.textContent);
  const numbers = (el: HTMLElement) =>
    [...el.querySelectorAll("tbody tr .mg-csv-no")].map((n) => n.getAttribute("data-n"));
  // 列の名前の ▾（列のメニューの入口）。
  const funnel = (el: HTMLElement, col: number) =>
    el.querySelectorAll<HTMLButtonElement>(".mg-csv-colmenu")[col];
  // 見出しの絞り込みの印。絞っているか並べ替えている列にだけ出る。
  const headMark = (el: HTMLElement, col: number) =>
    el.querySelector<HTMLElement>(`.mg-csv-head th[data-c="${col}"] .mg-csv-funnel`);
  const pop = () => document.querySelector<HTMLElement>(".mg-csv-filter-pop");
  const row = (label: string) =>
    [...pop()!.querySelectorAll<HTMLButtonElement>(".mg-csv-filter-row, button")].find((b) =>
      b.textContent?.includes(label),
    )!;
  const bar = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>(".mg-imgdoc-bar button")].find(
      (b) => b.textContent === label,
    );

  it("値を外すとその行が消え、残った行は元の行番号のまま出る。帯に件数と解除が出る", async () => {
    const { el } = await table();
    act(() => funnel(el, 1).click());
    act(() => row("開発").click());
    expect(names(el)).toEqual(["佐藤", "高橋"]);
    expect(numbers(el)).toEqual(["2", "4"]);
    expect(headMark(el, 1)).not.toBeNull();
    expect(headMark(el, 0)).toBeNull();
    expect(el.querySelector(".mg-imgdoc-bar")!.textContent).toContain("2 / 3 行");

    act(() => bar(el, "絞り込みを解除")!.click());
    expect(names(el)).toEqual(["佐藤", "鈴木", "高橋"]);
    expect(bar(el, "絞り込みを解除")).toBeUndefined();
  });

  it("絞り込みと並べ替えはファイルごとに覚え、別のファイルへは持ち越さない", async () => {
    const { el, store } = await table();
    act(() => funnel(el, 1).click());
    act(() => row("開発").click());
    expect(names(el)).toEqual(["佐藤", "高橋"]);

    await reopen(store, "/本/別.csv");
    expect(names(el)).toEqual(["佐藤", "鈴木", "高橋"]);

    await reopen(store, "/本/表.csv");
    expect(names(el)).toEqual(["佐藤", "高橋"]);
    expect(Object.keys(store.get(csvFiltersAtom))).toEqual(["/本/表.csv"]);

    act(() => bar(el, "絞り込みを解除")!.click());
    expect(store.get(csvFiltersAtom)).toEqual({});
  });

  it("見出しの印は絞った列・並べ替えた列にだけ出て、並べ替えだけの列は向きの矢印になる", async () => {
    const { el } = await table();
    expect([0, 1, 2].map((c) => headMark(el, c))).toEqual([null, null, null]);
    act(() => funnel(el, 2).click());
    act(() => row("昇順").click());
    expect(headMark(el, 2)!.querySelector("[data-icon]")!.getAttribute("data-icon")).toBe("arrow_upward");
    expect(headMark(el, 0)).toBeNull();
  });

  it("含む文字で絞り、数の列は数として並べ替える", async () => {
    const { el } = await table();
    act(() => funnel(el, 2).click());
    act(() => row("昇順").click());
    expect(names(el)).toEqual(["高橋", "鈴木", "佐藤"]);
    const input = pop()!.querySelector("input")!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "00");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(names(el)).toEqual(["鈴木", "佐藤"]);
  });

  it("矢印の上下は、残った行だけを辿る", async () => {
    const { el } = await table();
    act(() => funnel(el, 1).click());
    act(() => row("開発").click());
    act(() => {
      el.querySelector("tbody td")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const t = el.querySelector("table")!;
    key(t, "ArrowDown");
    expect(el.querySelector<HTMLElement>(".is-sel")!.dataset.r).toBe("3");
  });

  it("数の列だけに範囲の欄を出し、「以上」を打つとその場で絞る", async () => {
    const { el } = await table();
    act(() => funnel(el, 1).click());
    expect(pop()!.querySelector(".mg-csv-filter-range")).toBeNull();
    act(() => funnel(el, 2).click());
    const min = pop()!.querySelector<HTMLInputElement>('[aria-label="以上"]')!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(min, "300");
      min.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(names(el)).toEqual(["佐藤", "鈴木"]);
    // 値の一覧も範囲に入るものだけになる。
    expect(
      [...pop()!.querySelectorAll(".mg-csv-filter-value")].map((v) => v.textContent),
    ).toEqual(["300", "1200"]);
  });

  it("値が 1 つだけの列では「すべて」を出さない（その値と同じことを指す）", async () => {
    content = "名前,区分\n佐藤,A\n鈴木,A\n";
    const shown = await show();
    act(() => button(shown.el).click());
    act(() => funnel(shown.el, 1).click());
    expect(pop()!.querySelector(".is-all")).toBeNull();
    act(() => funnel(shown.el, 0).click());
    expect(pop()!.querySelector(".is-all")).not.toBeNull();
  });

  it("外を押すと小窓を閉じ、▽ をもう一度押しても閉じる", async () => {
    const { el } = await table();
    act(() => funnel(el, 0).click());
    expect(pop()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(pop()).toBeNull();
    act(() => funnel(el, 0).click());
    act(() => {
      funnel(el, 0).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      funnel(el, 0).click();
    });
    expect(pop()).toBeNull();
  });
});

// 表の上の欄で、選んだ升目の値を見て直す。書き戻すのはその値の原文だけ。
describe("上の欄で値を直す", () => {
  const table = async () => {
    const shown = await show();
    act(() => button(shown.el).click());
    return shown;
  };
  const press = (el: Element, k: string, init: KeyboardEventInit = {}) =>
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
    });
  const pick = (el: HTMLElement) =>
    act(() => {
      el.querySelector("tbody td")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  const at = (el: HTMLElement) => el.querySelector(".mg-csv-bar-at")!.textContent;
  const input = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>(".mg-csv-bar-input")!;
  // React の制御された欄に字を入れる。
  const type = (box: HTMLTextAreaElement, value: string) =>
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(box, value);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("選んだ升目の位置と値が出て、矢印で動かすと替わる", async () => {
    const { el } = await table();
    expect(input(el).disabled).toBe(true);
    pick(el);
    expect(at(el)).toBe("A2");
    expect(input(el).value).toBe("山田, 太郎");
    press(el.querySelector("table")!, "ArrowRight");
    expect(at(el)).toBe("B2");
    expect(input(el).value).toBe("90");
  });

  it("直して Enter で、その値だけを書き戻し、表にも出る。⌘Z で戻す", async () => {
    const { el } = await table();
    pick(el);
    type(input(el), "山田, 花子");
    press(input(el), "Enter");
    expect(written).toEqual(['名前,点\n"山田, 花子",90\n鈴木,80\n']);
    expect(el.querySelector("tbody td")!.textContent).toBe("山田, 花子");
    // 書いたあとも同じ升目を選んだまま。
    expect(at(el)).toBe("A2");

    await act(async () => {
      el.querySelector("table")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", code: "KeyZ", metaKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(written.at(-1)).toBe('名前,点\n"山田, 太郎",90\n鈴木,80\n');
    expect(el.querySelector("tbody td")!.textContent).toBe("山田, 太郎");
  });

  it("Esc で直す前に戻し、書かない。変換を確定する Enter でも書かない", async () => {
    const { el } = await table();
    pick(el);
    type(input(el), "途中");
    press(input(el), "Enter", { isComposing: true });
    expect(written).toEqual([]);
    press(input(el), "Escape");
    expect(written).toEqual([]);
    expect(input(el).value).toBe("山田, 太郎");
  });

  it("上の欄で打つと、升目の中の欄にもその場で映る", async () => {
    const { el } = await table();
    pick(el);
    act(() => input(el).focus());
    type(input(el), "山田 一郎");
    const ed = el.querySelector<HTMLTextAreaElement>(".mg-csv-editor")!;
    expect(ed.classList.contains("is-on")).toBe(true);
    expect(ed.value).toBe("山田 一郎");
  });
});

// 列の名前か見出しを掴んで落とすと、その順でファイルを書き換える。
describe("列を掴んで動かす", () => {
  const table = async (text: string) => {
    content = text;
    const shown = await show();
    act(() => button(shown.el).click());
    return shown;
  };
  const heads = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>(".mg-csv-head th:not(.mg-csv-no)")];
  // 列 k の左端から dx の位置（表の左端からの px。試験の中では表は 0 に置かれる）。
  const xAt = (el: HTMLElement, k: number, dx: number) => {
    const ws = [...el.querySelectorAll<HTMLElement>("col")].map((c) => parseInt(c.style.width));
    return ws.slice(0, k + 1).reduce((a, b) => a + b, 0) + dx;
  };
  const mouse = (target: EventTarget, type: string, clientX: number) =>
    act(() => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX }));
    });
  // 列 from の見出しを掴み、列 onto の左端寄り（before）か右端寄り（after）で放す。
  const drag = (el: HTMLElement, from: number, onto: number, side: "before" | "after") => {
    const start = xAt(el, from, 5);
    mouse(heads(el)[from], "mousedown", start);
    const ws = [...el.querySelectorAll<HTMLElement>("col")].map((c) => parseInt(c.style.width));
    const end = xAt(el, onto, side === "before" ? 3 : ws[onto + 1] - 3);
    mouse(window, "mousemove", end);
    mouse(window, "mouseup", end);
  };
  const names = (el: HTMLElement) => heads(el).map((h) => h.querySelector(".mg-csv-hname")!.textContent);

  it("見出しを落とした位置へ列が動き、その順で原文を書き換える", async () => {
    const { el } = await table('名前,部署,金額\r\n"佐藤",営業,1200\r\n');
    drag(el, 0, 2, "after");
    expect(names(el)).toEqual(["部署", "金額", "名前"]);
    expect(written).toEqual(['部署,金額,名前\r\n営業,1200,"佐藤"\r\n']);
    drag(el, 2, 0, "before");
    expect(names(el)).toEqual(["名前", "部署", "金額"]);
  });

  it("列幅と絞り込みが列に付いて動き、⌘Z で原文と一緒に戻る", async () => {
    const { el, store } = await table("名前,部署,金額\n佐藤,営業,1200\n鈴木,開発,300\n");
    act(() => {
      store.set(csvWidthsAtom, { "/本/表.csv": { 0: 200 } });
      store.set(csvFiltersAtom, {
        "/本/表.csv": {
          filters: { 1: { head: "部署", text: "", picked: ["営業"], min: null, max: null } },
          sort: null,
        },
      });
    });
    expect(el.querySelectorAll("tbody tr").length).toBe(1);

    drag(el, 0, 2, "after");
    expect(store.get(csvWidthsAtom)["/本/表.csv"]).toEqual({ 2: 200 });
    expect(Object.keys(store.get(csvFiltersAtom)["/本/表.csv"].filters)).toEqual(["0"]);
    // 絞り込みは「部署」の列に付いたまま効いている。
    expect(el.querySelectorAll("tbody tr").length).toBe(1);

    await act(async () => {
      el.querySelector("table")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", code: "KeyZ", metaKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(names(el)).toEqual(["名前", "部署", "金額"]);
    expect(written.at(-1)).toBe("名前,部署,金額\n佐藤,営業,1200\n鈴木,開発,300\n");
    expect(store.get(csvWidthsAtom)["/本/表.csv"]).toEqual({ 0: 200 });
    expect(Object.keys(store.get(csvFiltersAtom)["/本/表.csv"].filters)).toEqual(["1"]);
  });

  it("同じ位置に落としても書かない。動かさずに放せば升目を選ぶだけ", async () => {
    const { el } = await table("a,b\n1,2\n");
    drag(el, 0, 0, "after");
    drag(el, 0, 1, "before");
    expect(written).toEqual([]);
    // 放した直後の click は選ばない（動かしたあと）。次の押下までには解ける。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    mouse(heads(el)[1], "mousedown", xAt(el, 1, 5));
    mouse(window, "mouseup", xAt(el, 1, 5));
    act(() => {
      heads(el)[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(el.querySelector(".is-sel")?.getAttribute("data-c")).toBe("1");
  });

  it("動かしている間は列を浮かせ、ほかの列を滑らせて落とす先を空ける。Esc で取りやめる", async () => {
    const { el } = await table("a,b,c\n1,2,3\n");
    mouse(heads(el)[0], "mousedown", xAt(el, 0, 5));
    mouse(window, "mousemove", xAt(el, 2, 2));
    const lift = el.querySelector(".mg-csv-lift")!;
    expect(lift.querySelector(".mg-csv-lift-letter")!.textContent).toBe("A");
    expect(lift.querySelector(".mg-csv-lift-head")!.textContent).toBe("a");
    expect(lift.querySelector(".mg-csv-lift-body")!.textContent).toBe("1");
    expect(el.querySelector(".mg-csv-grid")!.classList.contains("is-moving")).toBe(true);
    // b の列は a の幅だけ左へ詰める。
    const rules = el.querySelector(".mg-csv-grid style")!.textContent!;
    expect(rules).toMatch(/\[data-c="1"\].*translateX\(-\d+px\)/);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(el.querySelector(".mg-csv-lift")).toBeNull();
    mouse(window, "mouseup", xAt(el, 2, 2));
    expect(written).toEqual([]);
  });
});

// 選んだ升目が … で切れていたら、右へ広げた箱を重ねて全文を出す。
describe("選んだ升目を広げる", () => {
  const LONG = "東京都千代田区丸の内一丁目一番一号 〇〇ビル三階 ".repeat(3).trim();
  const table = async (text: string) => {
    content = text;
    const shown = await show();
    act(() => button(shown.el).click());
    return shown;
  };
  const pickAt = (el: HTMLElement, r: number, c: number) =>
    act(() => {
      el.querySelector(`[data-r="${r}"][data-c="${c}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  const press = (el: Element, k: string) =>
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    });
  const grow = (el: HTMLElement) => el.querySelector(".mg-csv-grow")?.textContent ?? null;

  it("長い値の升目を選ぶと全文を出し、短い値では出さない。動かすと付いてくる", async () => {
    // 長い値は列の幅の上限（320px）を超えて … で切れる。
    const { el } = await table(`住所,短\n${LONG},x\n"1行目\n2行目",y\n`);
    pickAt(el, 1, 0);
    expect(grow(el)).toBe(LONG);
    press(el.querySelector("table")!, "ArrowRight");
    expect(grow(el)).toBeNull();
    press(el.querySelector("table")!, "ArrowDown");
    press(el.querySelector("table")!, "ArrowLeft");
    // 改行のある値は、幅に収まっていても広げて改行ごと出す。
    expect(grow(el)).toBe("1行目\n2行目");
  });

  it("選択を外す・⌘Enter の小窓を出すと消え、見出しの行では出さない", async () => {
    const { el } = await table(`${LONG},b\n${LONG},x\n`);
    const t = () => el.querySelector("table")!;
    pickAt(el, 1, 0);
    expect(grow(el)).toBe(LONG);
    act(() => {
      t().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
    });
    expect(grow(el)).toBeNull();
    press(t(), "Escape");
    expect(grow(el)).toBe(LONG);
    press(t(), "Escape");
    expect(grow(el)).toBeNull();
    pickAt(el, 0, 0);
    expect(grow(el)).toBeNull();
  });
});

// 升目を選んで字を打てば、そのまま書き換えが始まる（Google スプレッドシートの手）。
describe("升目で字を打って直す", () => {
  const table = async (text = '名前,点\n"山田, 太郎",90\n鈴木,80\n') => {
    content = text;
    const shown = await show();
    act(() => button(shown.el).click());
    return shown;
  };
  const pickAt = (el: HTMLElement, r: number, c: number) =>
    act(() => {
      el.querySelector(`[data-r="${r}"][data-c="${c}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  const editor = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>(".mg-csv-editor")!;
  const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    });
  const type = (box: HTMLTextAreaElement, value: string) =>
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(box, value);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const sel = (el: HTMLElement) => {
    const c = el.querySelector<HTMLElement>("td.is-sel, th.is-sel");
    return c && `${c.dataset.r},${c.dataset.c}`;
  };
  const cellText = (el: HTMLElement, r: number, c: number) =>
    el.querySelector(`[data-r="${r}"][data-c="${c}"]`)!.textContent;

  it("選んで字を打つと書き換えが始まり、Enter で確定してその場に残る", async () => {
    const { el } = await table();
    pickAt(el, 2, 1);
    expect(document.activeElement).toBe(editor(el));
    expect(editor(el).classList.contains("is-on")).toBe(false);
    type(editor(el), "7");
    expect(editor(el).classList.contains("is-on")).toBe(true);
    type(editor(el), "75");
    press(editor(el), "Enter");
    expect(written).toEqual(['名前,点\n"山田, 太郎",90\n鈴木,75\n']);
    expect(cellText(el, 2, 1)).toBe("75");
    expect(sel(el)).toBe("2,1");
    expect(editor(el).classList.contains("is-on")).toBe(false);
  });

  it("日本語の変換が始まったら欄を見せ、変換中の Enter では確定しない", async () => {
    const { el } = await table();
    pickAt(el, 2, 0);
    act(() => {
      editor(el).dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    expect(editor(el).classList.contains("is-on")).toBe(true);
    type(editor(el), "すずき");
    press(editor(el), "Enter", { isComposing: true });
    expect(written).toEqual([]);
    type(editor(el), "佐々木");
    press(editor(el), "Enter");
    expect(cellText(el, 2, 0)).toBe("佐々木");
  });

  it("Tab で確定して右へ、Esc は直す前に戻す", async () => {
    const { el } = await table();
    pickAt(el, 2, 0);
    type(editor(el), "田中");
    press(editor(el), "Tab");
    expect(cellText(el, 2, 0)).toBe("田中");
    expect(sel(el)).toBe("2,1");
    type(editor(el), "0");
    press(editor(el), "Escape");
    expect(cellText(el, 2, 1)).toBe("80");
    expect(written.length).toBe(1);
  });

  it("2 回押す・Enter・F2 は今の値を残して始める", async () => {
    const { el } = await table();
    pickAt(el, 1, 0);
    act(() => {
      el.querySelector('[data-r="1"][data-c="0"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(editor(el).value).toBe("山田, 太郎");
    press(editor(el), "Escape");
    press(editor(el), "Enter");
    expect(editor(el).value).toBe("山田, 太郎");
    press(editor(el), "Escape");
    press(editor(el), "F2");
    expect(editor(el).classList.contains("is-on")).toBe(true);
  });

  it("直している途中でほかの升目を押すと、確定してから移る", async () => {
    const { el } = await table();
    pickAt(el, 2, 0);
    type(editor(el), "高橋");
    pickAt(el, 1, 1);
    expect(cellText(el, 2, 0)).toBe("高橋");
    expect(sel(el)).toBe("1,1");
  });

  it("Delete で空にし、⌘Z で戻して ⌘⇧Z でやり直す", async () => {
    const { el } = await table();
    pickAt(el, 2, 1);
    press(editor(el), "Delete");
    expect(cellText(el, 2, 1)).toBe("");
    press(editor(el), "z", { code: "KeyZ", metaKey: true });
    expect(cellText(el, 2, 1)).toBe("80");
    press(editor(el), "z", { code: "KeyZ", metaKey: true, shiftKey: true });
    expect(cellText(el, 2, 1)).toBe("");
  });

  it("数として読める値は右に寄せ、選んだ列の名前と行の番号に色を付ける", async () => {
    const { el } = await table();
    expect(el.querySelector('[data-r="1"][data-c="1"]')!.classList.contains("is-num")).toBe(true);
    expect(el.querySelector('[data-r="1"][data-c="0"]')!.classList.contains("is-num")).toBe(false);
    pickAt(el, 2, 1);
    expect([...el.querySelectorAll(".mg-csv-letters th.is-on")].map((t) => t.getAttribute("data-n"))).toEqual(["B"]);
    expect([...el.querySelectorAll("th.mg-csv-no.is-on")].map((t) => t.getAttribute("data-n"))).toEqual(["3"]);
  });
});

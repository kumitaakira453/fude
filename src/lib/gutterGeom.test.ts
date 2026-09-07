// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { addBelow, holdAt, onLine, tableGeometry } from "./gutterGeom";

// jsdom は組版を持たないので、矩形を当て木で置く。
//
// 表は左 100・上 200 から 300x120。行は 30 ずつ、列は 100 / 60 / 140。
// 重ねる層の原点（base）は左 80・上 180 に置いて、返る値が原点ぶん引かれて
// いることも一緒に見る。
const BASE = new DOMRect(80, 180, 400, 400);
const COLS = [
  [100, 200],
  [200, 260],
  [260, 400],
];
const ROW_TOP = 200;
const ROW_H = 30;

function rect(el: Element, r: DOMRect) {
  el.getBoundingClientRect = () => r;
}

// 見出しが <thead> に入る形（読むとき）と <tbody> に入る形（編集面）を組む。
function build(kind: "thead" | "tbody", rows: number) {
  const wrap = document.createElement("div");
  wrap.className = "mg-table-wrap";
  const table = document.createElement("table");
  wrap.appendChild(table);
  document.body.appendChild(wrap);

  const body = document.createElement("tbody");
  const head = kind === "thead" ? document.createElement("thead") : body;
  if (kind === "thead") table.appendChild(head);
  table.appendChild(body);

  for (let r = 0; r < rows; r++) {
    const tr = document.createElement("tr");
    (r === 0 ? head : body).appendChild(tr);
    for (const [left, right] of COLS) {
      const cell = document.createElement(r === 0 ? "th" : "td");
      tr.appendChild(cell);
      rect(cell, new DOMRect(left, ROW_TOP + r * ROW_H, right - left, ROW_H));
    }
    rect(tr, new DOMRect(100, ROW_TOP + r * ROW_H, 300, ROW_H));
  }

  const box = new DOMRect(100, ROW_TOP, 300, rows * ROW_H);
  rect(table, box);
  rect(wrap, box);
  return { wrap, table };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

// 3 行目（本体の 2 行目）の真ん中。
const midOfRow = (r: number) => ROW_TOP + r * ROW_H + ROW_H / 2;

describe("表の行・列を矩形から決める", () => {
  it("見出しが thead でも tbody でも、同じ見た目の行を指す", () => {
    const read = build("thead", 4);
    const edit = build("tbody", 4);
    const at = { x: 150, y: midOfRow(2) };

    // 読むときは本体だけを渡す。0 番が本体の 1 行目。
    const a = tableGeometry(
      read.table,
      Array.from(read.table.tBodies[0].rows),
      at,
      BASE,
    );
    // 編集面は見出しも含めて渡す。番号がそのまま編集モデルの行になる。
    const b = tableGeometry(edit.table, Array.from(edit.table.rows), at, BASE);

    expect(a?.row?.index).toBe(1);
    expect(b?.row?.index).toBe(2);
    // 指しているのは同じ行なので、置き場所は一致する。
    expect(a?.row?.top).toBe(b?.row?.top);
    expect(a?.row?.height).toBe(ROW_H);
  });

  it("番号は原点からの位置で返る", () => {
    const { table } = build("tbody", 3);
    const geo = tableGeometry(table, Array.from(table.rows), { x: 150, y: midOfRow(1) }, BASE);
    expect(geo?.table.left).toBe(100 - BASE.left);
    expect(geo?.table.top).toBe(ROW_TOP - BASE.top);
    expect(geo?.row?.top).toBe(ROW_TOP + ROW_H - BASE.top);
  });

  it("指した幅の列を選ぶ", () => {
    const { table } = build("tbody", 3);
    const rows = Array.from(table.rows);
    const colAt = (x: number) =>
      tableGeometry(table, rows, { x, y: midOfRow(1) }, BASE)?.col?.index;
    expect(colAt(150)).toBe(0);
    expect(colAt(230)).toBe(1);
    expect(colAt(300)).toBe(2);
  });

  it("表の外へ出ても、一番近い行・列へ寄せる", () => {
    const { table } = build("tbody", 3);
    const rows = Array.from(table.rows);
    const above = tableGeometry(table, rows, { x: 40, y: 100 }, BASE);
    expect(above?.row?.index).toBe(0);
    expect(above?.col?.index).toBe(0);
    const below = tableGeometry(table, rows, { x: 900, y: 900 }, BASE);
    expect(below?.row?.index).toBe(2);
    expect(below?.col?.index).toBe(2);
  });

  it("横に隠れている表では、列を足す帯を出さない", () => {
    const { wrap, table } = build("tbody", 3);
    // 枠より表が広い。右端は見えていない。
    rect(table, new DOMRect(100, ROW_TOP, 500, 3 * ROW_H));
    rect(wrap, new DOMRect(100, ROW_TOP, 300, 3 * ROW_H));
    Object.defineProperty(wrap, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(wrap, "clientWidth", { value: 300, configurable: true });
    const geo = tableGeometry(table, Array.from(table.rows), { x: 150, y: midOfRow(1) }, BASE);
    expect(geo?.atRight).toBe(false);
    // 見えている幅で切る。
    expect(geo?.table.width).toBe(300);
    // 横スクロールする表では、行を足す帯は枠の下に置く。
    expect(geo?.bottom).toBe(ROW_TOP + 3 * ROW_H - BASE.top);
  });

  it("表が見えていなければ何も返さない", () => {
    const { wrap, table } = build("tbody", 3);
    rect(wrap, new DOMRect(1000, 1000, 10, 10));
    expect(tableGeometry(table, Array.from(table.rows), { x: 150, y: 210 }, BASE)).toBeNull();
  });
});

describe("addBelow", () => {
  const ADD = 16;
  const GAP = 12;

  it("空きが広ければ決めた分だけ離す", () => {
    expect(addBelow(100, 60, GAP)).toBe(112);
  });

  it("空きが狭ければ収まるところまで寄せる", () => {
    // 24px の空きに 16px のつまみ → 上下に 4px ずつ。
    expect(addBelow(100, 24, GAP)).toBe(104);
  });

  it("空きがちょうどなら隙間なく収まる", () => {
    expect(addBelow(100, ADD, GAP)).toBe(100);
  });

  it("空きが足りなければ表の下端をまたぐ（次のブロックへ入れない）", () => {
    // 8px しか無い → 4px 分だけ表に乗り、残り 12px が空きに入る。
    expect(addBelow(100, 8, GAP)).toBe(96);
    // 空きが無ければ下端をまたいで半分ずつ。
    expect(addBelow(100, 0, GAP)).toBe(100 - ADD / 2);
  });
});

describe("holdAt", () => {
  it("帯の真ん中に置く", () => {
    // 高さ 60 の行に 20 のつまみ → 上下に 20 ずつ。
    expect(holdAt(100, 60)).toBe(120);
  });

  it("帯がつまみより短ければ端に寄せる", () => {
    expect(holdAt(100, 12)).toBe(100);
  });
});

describe("onLine", () => {
  it("枠線の真ん中に載る", () => {
    // 幅 15 のつまみを x=100 の線に載せる → 92.5 から 107.5。
    expect(onLine(100, 15)).toBe(92.5);
  });
});

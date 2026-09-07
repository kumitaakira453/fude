// つまみの置き場所を決める幾何。読むときと編集面の両方から使う。
//
// ブロックのつまみ・表の行と列の帯を、当たり判定ではなく矩形から決める。
//
// 重ねた層や余白、指摘の印に邪魔されず、指している高さの行・幅の列をそのまま
// 選べる。表の外に居るときは一番近い行・列へ寄せる（つまみは表の外側に置くので、
// そこへ手を伸ばす途中で相手を見失わせない）。
//
// 読むときと編集面の両方から使う。行の数え方だけ違うので、候補の行は呼ぶ側が
// 渡す。読むときは見出しが `<thead>` に入るので本体だけを渡し、編集面は
// 見出しも `<tbody>` に入るので全ての行を渡す。

// つまみの置き場所。読むときと編集面で同じ見た目にするため、両方から読む。

// つまみの大きさ。掴み損ねないよう、見た目より広く取る。
export const GRIP = 24;
// 本文・表の縁からつまみまでの隙間。詰めると文字と一体に見えてしまう。
export const AWAY = 10;
// 行・列を掴む帯。掴む面は要るが、太いと表より目立ってしまう。
export const BAR = 15;
// 帯を出す縁の幅。表の真ん中を指している間は出さない（Notion と同じ）。
export const EDGE = 26;
// 行・列を足す帯。掴む帯と同じ太さに揃える。
export const ADD = 16;
export const ADD_AWAY = 6;
// つまみ 2 つ分（挿入 + 掴み）と、掴みだけのときに要る左の余白。
export const BOTH = GRIP * 2 + 4 + AWAY;
export const ONLY = GRIP + AWAY;

// ブロックの 1 行の高さ。見出しのように行が高いものでも文字の中心に並ぶよう、
// 実際に組まれた行送りを読む。
export function lineHeight(el: Element): number {
  const target = el.firstElementChild ?? el;
  const style = getComputedStyle(target);
  const value = parseFloat(style.lineHeight);
  if (Number.isFinite(value) && value > 0) return value;
  const size = parseFloat(style.fontSize);
  return Number.isFinite(size) && size > 0 ? size * 1.6 : 24;
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TableGeometry {
  table: Box;
  // 表の右端まで見えているか。横に隠れているうちは列を足す帯を出さない。
  atRight: boolean;
  // 行を足す帯を置く高さ。横スクロールする表では、枠の下（スクロールバーの
  // 外側）に置く。表の下端に置くとバーの上に重なる。
  bottom: number;
  // 番号は、渡した行の並びの中での位置。
  row: { index: number; top: number; height: number } | null;
  col: { index: number; left: number; width: number } | null;
}

// 2 つの矩形の重なり。重なりが無ければ null。
export function overlap(a: DOMRect, b: DOMRect): DOMRect | null {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

// 指している位置にある矩形。外に出ていれば端の 1 つへ寄せる。
export function pick(boxes: DOMRect[], at: number, axis: "x" | "y"): number {
  for (let i = 0; i < boxes.length; i++) {
    const start = axis === "y" ? boxes[i].top : boxes[i].left;
    const end = axis === "y" ? boxes[i].bottom : boxes[i].right;
    if (at < end || i === boxes.length - 1) return at < start && i === 0 ? 0 : i;
  }
  return boxes.length - 1;
}

export function relative(r: DOMRect, base: DOMRect): Box {
  return {
    top: r.top - base.top,
    left: r.left - base.left,
    width: r.width,
    height: r.height,
  };
}

// 出しているつまみの置き場所を、相手（何行目・何列目）を変えずに測り直す。
//
// 表は枠の中で横へスクロールする。指す場所が変わらなくても列の位置は動くので、
// 掴んでいる間やメニューを開いている間も、これで塗りを合わせ直す。
export function tableBands(
  table: HTMLTableElement,
  rows: readonly HTMLTableRowElement[],
  want: { row: number | null; col: number | null },
  base: DOMRect,
): TableGeometry | null {
  const head = table.tHead?.rows[0] ?? table.rows[0];
  if (!head) return null;
  // 横に溢れる表は枠の中でスクロールする。つまみと線は見えている範囲で切る。
  // 表そのものの幅で引くと、隠れている部分まで画面の端まで伸びてしまう。
  const wrap = table.closest(".mg-table-wrap") ?? table;
  const clip = wrap.getBoundingClientRect();
  const box = table.getBoundingClientRect();
  const visible = overlap(box, clip);
  if (!visible) return null;

  const rowEl = want.row === null ? null : rows[want.row];
  const cellEl = want.col === null ? null : head.cells[want.col];
  const rowBox = rowEl ? overlap(rowEl.getBoundingClientRect(), clip) : null;
  const colBox = cellEl ? overlap(cellEl.getBoundingClientRect(), clip) : null;
  const scrolls = wrap !== table && wrap.scrollWidth > wrap.clientWidth + 1;

  return {
    table: relative(visible, base),
    atRight: box.right <= clip.right + 1,
    bottom: (scrolls ? clip.bottom : visible.bottom) - base.top,
    row:
      want.row !== null && rowBox
        ? { index: want.row, top: rowBox.top - base.top, height: rowBox.height }
        : null,
    col:
      want.col !== null && colBox
        ? { index: want.col, left: colBox.left - base.left, width: colBox.width }
        : null,
  };
}

export function tableGeometry(
  table: HTMLTableElement,
  rows: readonly HTMLTableRowElement[],
  at: { x: number; y: number },
  base: DOMRect,
): TableGeometry | null {
  const head = table.tHead?.rows[0] ?? table.rows[0];
  if (!head) return null;
  const wrap = table.closest(".mg-table-wrap") ?? table;
  const clip = wrap.getBoundingClientRect();
  const visible = overlap(table.getBoundingClientRect(), clip);
  if (!visible) return null;

  const cells = Array.from(head.cells).map((c) => c.getBoundingClientRect());
  if (cells.length === 0) return null;
  const rowBoxes = rows.map((r) => r.getBoundingClientRect());
  // 指している位置を見えている範囲へ寄せる。隠れた列を選ばせない。
  const cx = Math.min(Math.max(at.x, visible.left + 1), visible.right - 1);
  const cy = Math.min(Math.max(at.y, visible.top + 1), visible.bottom - 1);
  return tableBands(
    table,
    rows,
    {
      row: rowBoxes.length > 0 ? pick(rowBoxes, cy, "y") : null,
      col: pick(cells, cx, "x"),
    },
    base,
  );
}

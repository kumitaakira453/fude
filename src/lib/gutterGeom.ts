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
// 行・列を足す帯。掴む帯より少し細い。中の「+」はこの太さに収める
// （はみ出すと、丸めた角で切れて寄って見える）。
export const ADD = 14;
// 帯を表から離す幅。触れると罫線と一本に見え、離すとどの表のものか読みにくい。
export const ADD_AWAY = 4;
// つまみ 2 つ分（挿入 + 掴み）と、掴みだけのときに要る左の余白。
export const BOTH = GRIP * 2 + 4 + AWAY;
export const ONLY = GRIP + AWAY;

// つまみを合わせる 1 行目の箱。
//
// 要素の中身をまとめて測ると、`Range.getClientRects()` が「丸ごと入っている
// 要素の枠」も返すので、中に段落を抱えるもの（編集面の箇条書きの項目や
// 囲み）では全行ぶんの箱が先に来る。それを 1 行目と取るとつまみが項目の
// 真ん中に落ちる。字のところを直に測る。
export function firstLine(el: Element): DOMRect | null {
  // トグルの見出しは入力欄で、字を持たない。字を探すと中身の 1 行目に落ちて
  // つまみが本文の行に付くので、見出しの帯があればそれを 1 行目とする。
  const head = el.querySelector(":scope > .mg-details-head");
  if (head) return head.getBoundingClientRect();
  const doc = el.ownerDocument;
  const walk = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const span = doc.createRange();
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if (!node.nodeValue?.trim()) continue;
    span.selectNodeContents(node);
    for (const rect of span.getClientRects()) {
      if (rect.height > 0) return rect;
    }
  }
  // 字を持たないもの（空の項目、チェックだけの項目、図など）は枠から測る。
  span.selectNodeContents(el);
  const rects = span.getClientRects();
  return rects.length > 0 ? rects[0] : null;
}

// つまみを置く基準になる、項目の左端。1 行目で最も左にある字に合わせる。
// 箇条書きの記号（•）は箱を持たないので、リストが記号のために空けている
// 幅の分だけ左へ寄せる。チェックリストはチェックが項目の中にあるので、
// 1 行目の左端がそのまま基準になる。
export function itemEdge(li: HTMLElement): number {
  const box = li.getBoundingClientRect();
  const line = firstLine(li) ?? box;
  if (li.querySelector(".mg-task-check")) return line.left;
  const list = li.parentElement?.getBoundingClientRect();
  // 行頭の印が占めている幅を空ける。印はリストの内側の字下げに入ることも
  // （箇条書きの丸）、項目自身の字下げに入ることもある（番号の丸）。
  // 空けないと、つまみが印の上に重なる。
  const inset = parseFloat(getComputedStyle(li).paddingLeft) || 0;
  const reserve = (list ? Math.max(0, box.left - list.left) : 0) + inset;
  return line.left - reserve;
}

// 字下げ 1 段の幅。入れ子が既にあればそこから測る。無ければ項目が印に空けて
// いる幅を使い、それも取れなければ既定の刻みにする。運ぶときに指の横位置から
// 落とす深さを決めるのに使う。
const INDENT = 24;

export function indentStep(el: HTMLElement): number {
  const deep = el.querySelector<HTMLElement>("li :is(ul, ol) > li");
  const shallow = el.querySelector<HTMLElement>(":scope > li");
  if (deep && shallow) {
    const step = itemEdge(deep) - itemEdge(shallow);
    if (step > 4) return step;
  }
  // 入れ子がまだ無いときは、項目が行頭の印に空けている幅を 1 段とみなす。
  const pad = shallow ? parseFloat(getComputedStyle(shallow).paddingLeft) || 0 : 0;
  return pad > 4 ? pad : INDENT;
}

// いちばん外の項目の左端。深さ 0 の基準。
export function itemEdgeOf(el: HTMLElement): number {
  const first = el.querySelector<HTMLElement>(":scope > li");
  return first ? itemEdge(first) : el.getBoundingClientRect().left;
}

// 指している高さの項目。項目の外（間の余白など）を指していても、一番近い
// 項目に寄せる。箇条書きで掴む相手は常に項目にする（リスト全体のつまみと
// 並べると、どちらを掴んでいるのか分からなくなる）。
export function itemAtY(
  blockEl: Element,
  y: number,
  selector: string,
): HTMLElement | null {
  let hit: HTMLElement | null = null;
  let best = Infinity;
  let near: HTMLElement | null = null;
  let gap = Infinity;
  for (const li of blockEl.querySelectorAll<HTMLElement>(selector)) {
    const r = li.getBoundingClientRect();
    const away = y < r.top ? r.top - y : y >= r.bottom ? y - r.bottom : 0;
    if (away === 0) {
      // 入れ子では内側（小さい方）を採る。
      if (r.height < best) {
        best = r.height;
        hit = li;
      }
      continue;
    }
    if (away < gap) {
      gap = away;
      near = li;
    }
  }
  return hit ?? near;
}

// つまみを合わせる 1 行目。項目全体の真ん中だと、2 行以上の項目で行の間に
// 落ちる。
export function itemLine(li: HTMLElement, box: DOMRect): DOMRect {
  return firstLine(li) ?? box;
}

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

// 表の下に足すつまみの置き場所。
//
// 表の下端から決め打ちで離すと、次のブロックとの空きが狭い文書（表のすぐ下に
// 見出しが来るなど）でつまみが次のブロックに重なる。空きに収まるところまで
// 寄せ、それでも足りなければ表の下端をまたぐ（次のブロックへは入れない）。
//
// room は表の下端から次のブロックの上端までの画素。
export function addAway(room: number, gap: number): number {
  return Math.max(-ADD / 2, Math.min(gap, (room - ADD) / 2));
}

// 行と列で同じ値を使う。列の右には余地があるので決め打ちでも収まるが、
// 別の値にすると下と右で空きが食い違って見える。
export function addBelow(bottom: number, room: number, gap: number): number {
  return bottom + addAway(room, gap);
}

// 表の下端から次のブロックの上端までの空き。読むとき側は目印で引ける。
//
// 次のブロックが無ければ、下にあるのは本文の末尾の余白だけ。ぶつかる相手が
// 居ないので空きは限りなく、帯を表へ寄せる理由が無い。入れ物の下端で測ると
// 最後のブロックの下端と同じになり、空きが無いことにされてしまう。
export function roomBelow(
  content: HTMLElement,
  index: number,
  el: HTMLElement | null,
): number {
  const here = el ?? content.querySelector<HTMLElement>(`[data-mg-block="${index}"]`);
  if (!here) return 0;
  const next = content.querySelector<HTMLElement>(
    `[data-mg-block="${index + 1}"]`,
  );
  if (!next) return Infinity;
  return Math.max(0, next.getBoundingClientRect().top - here.getBoundingClientRect().bottom);
}

// 行・列を掴むつまみの短辺。行は高さ、列は幅がこれになる。
//
// 表の縁いっぱいに伸ばすと、どの行を掴んでいるのかは分かるが、選んでいる
// 範囲の囲みと二重の主張になる。Notion と同じく短いつまみにして、囲みに
// 「どこが対象か」を任せる。
export const HOLD = 20;

// 表そのものを掴むつまみと、表の縁の間。
export const HOLD_GAP = 5;

// 「ここから掴める」だけを示す小さな棒。太さと長さ。
//
// つまみをいきなり出さないのは、表の真ん中を指しているあいだ何も出ないと
// 掴めることが画面から分からず、かといって常にアイコンを出すと本文より
// 目立つため。棒で場所だけ示し、寄ったら育てる（Notion と同じ二段）。
export const NUB = 3;
export const NUB_LONG = 18;

// つまみを育てるか。縁からこの帯の中に指があれば育てる。
export function nearEdge(at: number, edge: number, band = EDGE): boolean {
  return at <= edge + band;
}

// 行・列のつまみは、帯の外に離して置かずに**枠線の上へ載せる**。
// 外へ出すと表からも離れて、どの行のものか読み取りにくい。線をまたぐと
// 「その線から掴む」ように見える（Notion と同じ）。
export function onLine(edge: number, thick: number): number {
  return edge - thick / 2;
}

// 帯の真ん中に短いつまみを置く。start は行の上端 / 列の左端。
export function holdAt(start: number, length: number): number {
  return start + Math.max(0, length - HOLD) / 2;
}

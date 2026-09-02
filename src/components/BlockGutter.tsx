import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { blockIndexOf, blockRect, topmostBlock } from "../lib/domText";
import { setDragPreview } from "../lib/dragImage";
import { Icon } from "./Icon";

// ブロックを掴んで動かすための層。表のときは行と列のつまみも出す。
//
// 本文の DOM は書き換えない。位置を測って重ねるだけなので、つまみが出ても
// 組版は動かない（AnchorOverlay と同じ持ち方）。
//
// 掴む相手は 3 種。ブロック全体（表なら左上の角）、表の行、表の列。
// 表の行番号は描画された並びから読む。GFM の表はソースの 1 行が 1 つの tr に
// なるので、本体の行は「tbody 内の位置 + 2」がソースの行になる
// （0 行目が見出し、1 行目が区切り）。

const BLOCK_MIME = "application/x-mdglow-block";
const ROW_MIME = "application/x-mdglow-trow";
const COL_MIME = "application/x-mdglow-tcol";

// つまみの大きさ。掴み損ねないよう、見た目より広く取る。
const GRIP = 24;
// 本文・表の縁からつまみまでの隙間。詰めると文字と一体に見えてしまう。
const AWAY = 10;
// つまみ 2 つ分（挿入 + 掴み）と、掴みだけのときに要る幅。
const BOTH = GRIP * 2 + 4 + AWAY;
const ONLY = GRIP + AWAY;
// 表の行・列の帯。掴む面は要るが、太いと表より目立ってしまう。
const BAR = 15;
// 帯を出す縁の幅。表の真ん中を指している間は出さない（Notion と同じ）。
const EDGE = 26;
// 行・列を足す帯。掴む帯と同じ太さに揃える。表の下の余白（1.4rem）に
// 収まる範囲で、押しやすさを優先する。
const ADD = 16;
const ADD_AWAY = 6;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface View {
  index: number;
  atRight: boolean;
  bottom: number;
  // 非表のブロックの外枠。メニューの対象を塗るのに使う。
  box: Box | null;
  // 箇条書きの項目。Markdown ではリスト全体が 1 ブロックだが、掴む単位は項目。
  item: { at: number; top: number; height: number; box: Box } | null;
  // 非表のとき: 1 行目の中心（本文の座標）。つまみをこの高さに揃える。
  y: number;
  // 左余白の広さ。狭い画面では出すつまみを減らす。
  room: number;
  // 表のときだけ。
  table: Box | null;
  row: { line: number; top: number; height: number } | null;
  col: { index: number; left: number; width: number } | null;
}

type Kind = "block" | "row" | "col" | "item";
export type Part = "row" | "col";
export type TableAct =
  "insertBefore" | "insertAfter" | "duplicate" | "clear" | "delete";

interface Guide {
  kind: Kind;
  top: number;
  left: number;
  length: number;
}

const ITEM_MIME = "application/x-mdglow-item";

const MIME: Record<Kind, string> = {
  block: BLOCK_MIME,
  row: ROW_MIME,
  col: COL_MIME,
  item: ITEM_MIME,
};

// 同じ場所を指し続けている間は描き直さない。マウスを動かすだけで層を
// 組み直すと、大きな本文で目に見えて重くなる。
function same(a: View | null, b: View): boolean {
  return (
    !!a &&
    a.index === b.index &&
    a.room === b.room &&
    a.atRight === b.atRight &&
    a.bottom === b.bottom &&
    (a.box?.top ?? -1) === (b.box?.top ?? -1) &&
    (a.item?.at ?? -1) === (b.item?.at ?? -1) &&
    Math.abs(a.y - b.y) < 0.5 &&
    (a.row?.line ?? -1) === (b.row?.line ?? -1) &&
    (a.col?.index ?? -1) === (b.col?.index ?? -1) &&
    (a.table?.top ?? -1) === (b.table?.top ?? -1)
  );
}

function relative(r: DOMRect, base: DOMRect): Box {
  return {
    top: r.top - base.top,
    left: r.left - base.left,
    width: r.width,
    height: r.height,
  };
}

// 相手のブロックは縦位置から決める。当たり判定で拾うと、重ねた層や指摘の印、
// 本文の外の余白で相手を見失う。
// 指している高さの項目。入れ子は内側（背の低い方）が勝つ。
// 当たり判定で拾うと、余白に出た瞬間に相手を見失う。
function itemAtY(blockEl: Element, y: number): HTMLElement | null {
  let hit: HTMLElement | null = null;
  let best = Infinity;
  for (const li of blockEl.querySelectorAll<HTMLElement>("li[data-mg-item]")) {
    const r = li.getBoundingClientRect();
    if (y < r.top || y >= r.bottom) continue;
    if (r.height < best) {
      best = r.height;
      hit = li;
    }
  }
  return hit;
}

function numberOf(el: Element | null, key: string): number | null {
  const raw = (el as HTMLElement | null)?.dataset?.[key];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function blockAtY(
  content: HTMLElement,
  y: number,
): { el: HTMLElement; index: number } | null {
  const el = topmostBlock(content, y);
  const index = el ? blockIndexOf(el) : null;
  return el && index !== null ? { el, index } : null;
}

// ブロックの 1 行の高さ。見出しのように行が高いものでも文字の中心に並ぶよう、
// 実際に組まれた行送りを読む。
function lineHeight(el: Element): number {
  const target = el.firstElementChild ?? el;
  const style = getComputedStyle(target);
  const value = parseFloat(style.lineHeight);
  if (Number.isFinite(value) && value > 0) return value;
  const size = parseFloat(style.fontSize);
  return Number.isFinite(size) && size > 0 ? size * 1.6 : 24;
}

// 表の中の行と列は、当たり判定ではなく矩形から決める。重ねた層や余白に
// 邪魔されず、指している高さの行・幅の列をそのまま選べる。
// 表の外に居るときは、一番近い行・列に寄せる。
interface Geometry {
  table: Box;
  // 表の右端まで見えているか。横に隠れているうちは列を足す帯を出さない。
  atRight: boolean;
  // 行を足す帯を置く高さ。横スクロールする表では、枠の下（スクロールバーの
  // 外側）に置く。表の下端に置くとバーの上に重なる。
  bottom: number;
  row: { line: number; top: number; height: number } | null;
  col: { index: number; left: number; width: number } | null;
}

// 2 つの矩形の重なり。重なりが無ければ null。
function overlap(a: DOMRect, b: DOMRect): DOMRect | null {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function pick(boxes: DOMRect[], at: number, axis: "x" | "y"): number {
  for (let i = 0; i < boxes.length; i++) {
    const start = axis === "y" ? boxes[i].top : boxes[i].left;
    const end = axis === "y" ? boxes[i].bottom : boxes[i].right;
    if (at < end || i === boxes.length - 1)
      return at < start && i === 0 ? 0 : i;
  }
  return boxes.length - 1;
}

function tableGeometry(
  blockEl: Element,
  x: number,
  y: number,
  base: DOMRect,
): Geometry | null {
  const table = blockEl.querySelector("table");
  if (!table) return null;
  const head = table.tHead?.rows[0] ?? table.rows[0];
  if (!head) return null;
  // 横に溢れる表は枠の中でスクロールする。つまみと線は見えている範囲で切る。
  // 表そのものの幅で引くと、隠れている部分まで画面の端まで伸びてしまう。
  const wrap = table.closest(".mg-table-wrap") ?? table;
  const clip = wrap.getBoundingClientRect();
  const visible = overlap(table.getBoundingClientRect(), clip);
  if (!visible) return null;

  const cells = Array.from(head.cells).map((c) => c.getBoundingClientRect());
  if (cells.length === 0) return null;
  const bodyRows = Array.from(table.tBodies[0]?.rows ?? []);
  const rowBoxes = bodyRows.map((r) => r.getBoundingClientRect());
  // 指している位置を見えている範囲へ寄せる。隠れた列を選ばせない。
  const cx = Math.min(Math.max(x, visible.left + 1), visible.right - 1);
  const cy = Math.min(Math.max(y, visible.top + 1), visible.bottom - 1);
  const colIndex = pick(cells, cx, "x");
  const rowIndex = rowBoxes.length > 0 ? pick(rowBoxes, cy, "y") : -1;
  const colBox = overlap(cells[colIndex], clip);
  const rowBox = rowIndex >= 0 ? overlap(rowBoxes[rowIndex], clip) : null;

  const scrolls = wrap !== table && wrap.scrollWidth > wrap.clientWidth + 1;
  return {
    table: relative(visible, base),
    atRight: table.getBoundingClientRect().right <= clip.right + 1,
    bottom: (scrolls ? clip.bottom : visible.bottom) - base.top,
    row:
      rowIndex >= 0 && rowBox
        ? {
            // 0 行目が見出し、1 行目が区切り。本体は 2 行目から。
            line: rowIndex + 2,
            top: rowBox.top - base.top,
            height: rowBox.height,
          }
        : null,
    col: colBox
      ? {
          index: colIndex,
          left: colBox.left - base.left,
          width: colBox.width,
        }
      : null,
  };
}

export function BlockGutter({
  content,
  scroller,
  contentKey,
  isTable,
  onEdit,
  onComment,
  onMove,
  onInsert,
  onDuplicate,
  onDelete,
  onTableMove,
  onTableAct,
  onTableAppend,
  onItemMove,
  onItemAct,
  itemAt,
}: {
  content: HTMLElement | null;
  scroller: HTMLElement | null;
  // ファイルが変わったら測り直す。
  contentKey: string;
  // そのブロックが表そのものか。callout の中の表などは行・列を掴ませない。
  isTable: (index: number) => boolean;
  onEdit: (index: number) => void;
  onComment: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onInsert: (index: number, side: "before" | "after") => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  // 表の行・列。kind で行と列を分け、at は行番号または列番号。
  onTableMove: (index: number, kind: Part, from: number, to: number) => void;
  onTableAct: (index: number, kind: Part, at: number, act: TableAct) => void;
  onTableAppend: (index: number, kind: Part) => void;
  // 箇条書きの項目。at は記号がある行番号。
  onItemMove: (index: number, from: number, to: number) => void;
  onItemAct: (index: number, at: number, act: TableAct) => void;
  // その位置が箇条書きの何行目の項目か。無ければ null。
  itemAt: (
    index: number,
    offset: number,
  ) => { from: number; to: number } | null;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const menuBox = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  // 何のメニューか。ブロックのつまみは項目一式、行・列は削除だけ。
  const [menu, setMenu] = useState<{
    kind: Kind;
    index: number;
    at: number;
    x: number;
    y: number;
  } | null>(null);
  const viewRef = useRef<View | null>(null);
  // 掴んでいる相手。素の listener からも読むので ref に置く。
  // box は表の矩形（行・列を掴んだときだけ）。帯の上を動いている間も、
  // 表の中へ座標を寄せて落とす先を決めるために使う。
  const heldRef = useRef<{
    kind: Kind;
    index: number;
    at: number;
    box: Box | null;
  } | null>(null);
  const toRef = useRef<number | null>(null);
  // 掴んでいる種別。掴んでいる行・列を塗って示すために描画へも渡す。
  const [holding, setHolding] = useState<Kind | null>(null);
  // メニューを開いている間は相手を変えない。素の listener からも読む。
  const menuRef = useRef<boolean>(false);
  menuRef.current = menu !== null;

  const show = (next: View | null) => {
    viewRef.current = next;
    setView(next);
  };

  useEffect(() => {
    show(null);
    setGuide(null);
    setMenu(null);
  }, [contentKey]);

  useEffect(() => {
    if (!content) return;
    // 見張るのはスクロール枠。つまみは本文の外の余白に置くので、本文の要素だけを
    // 見ていると、余白に直接入ってきた時に何も起きない。
    const host = scroller ?? content;

    const onMouseMove = (e: MouseEvent) => {
      if (heldRef.current || menuRef.current) return;
      // つまみの上に来ても保つ。消えると押せない。
      if (layerRef.current?.contains(e.target as Node)) return;
      const hit = blockAtY(content, e.clientY);
      // 本文の外（上下の余白）では直前の相手を保つ。
      if (!hit) return;

      const base = content.getBoundingClientRect();
      // 表のつまみは表の外側（左と上）に置く。そこへ向かう途中で表から離れると
      // 相手が別のブロックに変わって消えてしまうので、少し外まで表として扱う。
      const held = viewRef.current?.table;
      if (held && !isTable(hit.index)) {
        const pad = GRIP + AWAY + 4;
        const near =
          e.clientX >= base.left + held.left - pad &&
          e.clientX <= base.left + held.left + held.width + pad &&
          e.clientY >= base.top + held.top - pad &&
          e.clientY <= base.top + held.top + held.height + pad;
        if (near) return;
      }
      const room = scroller
        ? base.left - scroller.getBoundingClientRect().left
        : BOTH;
      const geo = isTable(hit.index)
        ? tableGeometry(hit.el, e.clientX, e.clientY, base)
        : null;

      if (geo) {
        // 行は左の縁、列は上の縁を指したときだけ出す。表の内側どこでも出すと
        // 常に付いて回って読みにくい。外の帯の上も同じ判定で通る。
        const onLeft = e.clientX <= base.left + geo.table.left + EDGE;
        const onTop = e.clientY <= base.top + geo.table.top + EDGE;
        const next: View = {
          index: hit.index,
          y: 0,
          room,
          atRight: geo.atRight,
          bottom: geo.bottom,
          box: null,
          item: null,
          table: geo.table,
          row: onLeft ? geo.row : null,
          col: onTop ? geo.col : null,
        };
        if (!same(viewRef.current, next)) show(next);
        return;
      }

      const box = blockRect(hit.el);
      if (!box) return;
      // 箇条書きは項目ごとに掴む。指している高さの li から行番号を引く。
      const li = itemAtY(hit.el, e.clientY);
      const anchorAt = numberOf(li, "mgItem");
      const found =
        li && anchorAt !== null ? itemAt(hit.index, anchorAt) : null;
      const liBox = li ? li.getBoundingClientRect() : null;
      const next: View = {
        index: hit.index,
        atRight: true,
        bottom: 0,
        box: relative(box, base),
        item:
          found && liBox
            ? {
                at: found.from,
                top: liBox.top - base.top,
                height: liBox.height,
                box: relative(liBox, base),
              }
            : null,
        // ブロックの上端から半行下げる。行箱を直に測ると、コールアウトのように
        // 中に別の箱を抱えるブロックで見当違いの行に付く。
        y: box.top - base.top + Math.min(lineHeight(hit.el), box.height) / 2,
        room,
        table: null,
        row: null,
        col: null,
      };
      if (!same(viewRef.current, next)) show(next);
    };

    const onMouseLeave = () => {
      if (!heldRef.current && !menuRef.current) show(null);
    };

    const onDragOver = (e: DragEvent) => {
      const held = heldRef.current;
      if (!held || !e.dataTransfer?.types.includes(MIME[held.kind])) return;
      const base = content.getBoundingClientRect();

      if (held.kind === "block") {
        const hit = blockAtY(content, e.clientY);
        const box2 = hit ? blockRect(hit.el) : null;
        if (!hit || !box2) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const after = e.clientY > box2.top + box2.height / 2;
        toRef.current = after ? hit.index + 1 : hit.index;
        setGuide({
          kind: "block",
          top: (after ? box2.bottom : box2.top) - base.top,
          left: 0,
          length: base.width,
        });
        return;
      }

      if (held.kind === "item") {
        const hit = blockAtY(content, e.clientY);
        const li = hit && hit.index === held.index ? itemAtY(hit.el, e.clientY) : null;
        const anchorAt = numberOf(li, "mgItem");
        const found = anchorAt === null ? null : itemAt(held.index, anchorAt);
        if (!li || !found) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const box = li.getBoundingClientRect();
        const after = e.clientY > box.top + box.height / 2;
        toRef.current = after ? found.to : found.from;
        setGuide({
          kind: "item",
          top: (after ? box.bottom : box.top) - base.top,
          left: 0,
          length: base.width,
        });
        return;
      }

      // 帯の上を動いている間は表から外れている。掴んだ表の矩形へ座標を寄せる。
      const box = held.box;
      const hit = blockAtY(
        content,
        box
          ? Math.min(
              Math.max(e.clientY, base.top + box.top + 2),
              base.top + box.top + box.height - 2,
            )
          : e.clientY,
      );
      const geo =
        hit && hit.index === held.index
          ? tableGeometry(hit.el, e.clientX, e.clientY, base)
          : null;
      if (!geo) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (held.kind === "row") {
        if (!geo.row) return;
        const after = e.clientY > base.top + geo.row.top + geo.row.height / 2;
        toRef.current = after ? geo.row.line + 1 : geo.row.line;
        setGuide({
          kind: "row",
          top: geo.row.top + (after ? geo.row.height : 0),
          left: geo.table.left,
          length: geo.table.width,
        });
        return;
      }

      if (!geo.col) return;
      const after = e.clientX > base.left + geo.col.left + geo.col.width / 2;
      toRef.current = after ? geo.col.index + 1 : geo.col.index;
      setGuide({
        kind: "col",
        top: geo.table.top,
        left: geo.col.left + (after ? geo.col.width : 0),
        length: geo.table.height,
      });
    };

    const onDrop = (e: DragEvent) => {
      const held = heldRef.current;
      const to = toRef.current;
      heldRef.current = null;
      toRef.current = null;
      setGuide(null);
      setHolding(null);
      if (!held || to === null) return;
      e.preventDefault();
      if (held.kind === "block") onMove(held.at, to);
      else if (held.kind === "item") onItemMove(held.index, held.at, to);
      else onTableMove(held.index, held.kind, held.at, to);
    };

    host.addEventListener("mousemove", onMouseMove);
    host.addEventListener("mouseleave", onMouseLeave);
    host.addEventListener("dragover", onDragOver);
    host.addEventListener("drop", onDrop);
    return () => {
      host.removeEventListener("mousemove", onMouseMove);
      host.removeEventListener("mouseleave", onMouseLeave);
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("drop", onDrop);
    };
  }, [content, scroller, isTable, onMove, onTableMove]);

  if (!content) return null;

  const hold =
    (kind: Kind, index: number, at: number, box: Box | null = null) =>
    (e: React.DragEvent) => {
      heldRef.current = { kind, index, at, box };
      setHolding(kind);
      e.dataTransfer.setData(MIME[kind], String(at));
      e.dataTransfer.effectAllowed = "move";
      // 掴んだものを薄い写しで見せる。大きすぎるときは名前の札に落ちる。
      setDragPreview(
        e.dataTransfer,
        previewOf(kind, index, at),
        label(kind, index),
      );
      setMenu(null);
    };

  // 写しに使う要素。ブロックはその中身、表は掴んだ行か見出しのセル。
  const previewOf = (kind: Kind, index: number, at: number): Element | null => {
    const blockEl = content.querySelector(`[data-mg-block="${index}"]`);
    if (!blockEl) return null;
    if (kind === "block") return blockEl.firstElementChild;
    if (kind === "item") {
      for (const li of blockEl.querySelectorAll<HTMLElement>("li[data-mg-item]")) {
        if (numberOf(li, "mgItem") !== null && itemAt(index, numberOf(li, "mgItem") as number)?.from === at) {
          return li;
        }
      }
      return null;
    }
    const table = blockEl.querySelector("table");
    if (!table) return null;
    if (kind === "row") return table.tBodies[0]?.rows[at - 2] ?? null;
    return (table.tHead?.rows[0] ?? table.rows[0])?.cells[at] ?? null;
  };

  // 掴んでいるものの名前。ブロックは書き出しを拝借する。
  const label = (kind: Kind, index: number): string => {
    if (kind === "row") return "行を移動";
    if (kind === "col") return "列を移動";
    if (kind === "item") return "項目を移動";
    const text = content
      .querySelector(`[data-mg-block="${index}"]`)
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
    if (!text) return "ブロックを移動";
    return text.length > 24 ? `${text.slice(0, 24)}…` : text;
  };
  const release = () => {
    heldRef.current = null;
    toRef.current = null;
    setHolding(null);
    setGuide(null);
    show(null);
  };

  // 行・列のメニュー。並びは Notion に合わせる。
  const partItems = (kind: Part, index: number, at: number) => {
    const act = (a: TableAct) => () => onTableAct(index, kind, at, a);
    const row = kind === "row";
    return [
      {
        icon: row ? "arrow_upward" : "arrow_back",
        label: row ? "上に挿入" : "左に挿入",
        run: act("insertBefore"),
      },
      {
        icon: row ? "arrow_downward" : "arrow_forward",
        label: row ? "下に挿入" : "右に挿入",
        run: act("insertAfter"),
      },
      { icon: "content_copy", label: "複製", run: act("duplicate") },
      { icon: "cancel", label: "コンテンツをクリア", run: act("clear") },
      { icon: "delete", label: "削除", run: act("delete"), danger: true },
    ];
  };

  // 箇条書きの項目のメニュー。行・列と同じ並びに揃える。
  const itemItems = (index: number, at: number) => {
    const act = (a: TableAct) => () => onItemAct(index, at, a);
    return [
      { icon: "arrow_upward", label: "上に挿入", run: act("insertBefore") },
      { icon: "arrow_downward", label: "下に挿入", run: act("insertAfter") },
      { icon: "content_copy", label: "複製", run: act("duplicate") },
      { icon: "delete", label: "削除", run: act("delete"), danger: true },
    ];
  };

  const items =
    menu === null
      ? []
      : menu.kind === "item"
        ? itemItems(menu.index, menu.at)
        : menu.kind !== "block"
          ? partItems(menu.kind, menu.index, menu.at)
        : [
            {
              icon: "add_comment",
              label: "指摘する",
              run: () => onComment(menu.index),
            },
            {
              icon: "edit",
              label: "編集する",
              run: () => onEdit(menu.index),
            },
            {
              icon: "vertical_align_top",
              label: "上に挿入",
              run: () => onInsert(menu.index, "before"),
            },
            {
              icon: "vertical_align_bottom",
              label: "下に挿入",
              run: () => onInsert(menu.index, "after"),
            },
            {
              icon: "content_copy",
              label: "複製",
              run: () => onDuplicate(menu.index),
            },
            {
              icon: "delete",
              label: "削除",
              run: () => onDelete(menu.index),
              danger: true,
            },
          ];

  // ブロックのつまみの置き場所。表なら左上の角、それ以外は 1 行目の左。
  // 余白に入る分だけ出す。本文の上に重ねると読めなくなるので、狭いときは
  // 掴みだけにする。
  const wide = !!view && view.room >= BOTH;
  // 非表のつまみの置き場所。表は行・列の帯の交点（下で別に置く）。
  // 箇条書きは項目の行に合わせる。リスト全体の上端に出すと、どの項目を
  // 掴むのか分からない。
  const anchor =
    view && !view.table
      ? {
          top: (view.item ? view.item.top + view.item.height / 2 : view.y) -
            GRIP / 2,
          left: view.room >= ONLY ? -(wide ? BOTH : ONLY) : 2,
        }
      : null;
  // 箇条書きの中では、掴む相手は項目そのもの。
  const grabKind: Kind = view?.item ? "item" : "block";
  const grabAt = view?.item ? view.item.at : (view?.index ?? 0);

  return (
    <>
      {createPortal(
        <div ref={layerRef} className="mg-block-layer not-prose">
          {view && anchor && (
            <div
              className="mg-gutter"
              style={{ top: anchor.top, left: anchor.left }}
            >
              {wide && (
                <button
                  type="button"
                  title="下に挿入"
                  className="mg-grip"
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={() =>
                    view.item
                      ? onItemAct(view.index, view.item.at, "insertAfter")
                      : onInsert(view.index, "after")
                  }
                >
                  <Icon name="add" size={17} />
                </button>
              )}
              <button
                type="button"
                title="ドラッグで移動 / クリックでメニュー"
                className="mg-grip mg-grip-hold"
                draggable
                onDragStart={hold(grabKind, view.index, grabAt)}
                onDragEnd={release}
                onClick={(e) =>
                  setMenu({
                    kind: grabKind,
                    index: view.index,
                    at: grabAt,
                    x: e.clientX,
                    y: e.clientY,
                  })
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({
                    kind: grabKind,
                    index: view.index,
                    at: grabAt,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
              >
                <Icon name="drag_indicator" size={17} />
              </button>
            </div>
          )}

          {/* 表そのものを動かすつまみ。行と列の帯が交わる点に中心を合わせる。
              大きさは他のブロックのつまみと同じ。表だけ小さいと、狙って
              触れるまでの手間がここだけ増える。 */}
          {view?.table && (
            <button
              type="button"
              title="ドラッグで表を移動 / クリックでメニュー"
              className="mg-grip mg-grip-hold"
              draggable
              style={{
                top: view.table.top - ADD_AWAY - BAR / 2 - GRIP / 2,
                left: view.table.left - ADD_AWAY - BAR / 2 - GRIP / 2,
                width: GRIP,
                height: GRIP,
              }}
              onDragStart={hold("block", view.index, view.index)}
              onDragEnd={release}
              onClick={(e) =>
                setMenu({
                  kind: "block",
                  index: view.index,
                  at: view.index,
                  x: e.clientX,
                  y: e.clientY,
                })
              }
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({
                  kind: "block",
                  index: view.index,
                  at: view.index,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            >
              <Icon name="drag_indicator" size={17} />
            </button>
          )}

          {view?.table && view.row && (
            <button
              type="button"
              title="ドラッグで移動 / クリックでメニュー"
              className="mg-grip mg-grip-hold mg-grip-bar"
              draggable
              style={{
                top: view.row.top,
                left: view.table.left - BAR - ADD_AWAY,
                width: BAR,
                height: view.row.height,
              }}
              onDragStart={hold("row", view.index, view.row.line, view.table)}
              onDragEnd={release}
              onClick={(e) =>
                setMenu({
                  kind: "row",
                  index: view.index,
                  at: view.row?.line ?? -1,
                  x: e.clientX,
                  y: e.clientY,
                })
              }
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({
                  kind: "row",
                  index: view.index,
                  at: view.row?.line ?? -1,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            >
              <Icon name="drag_indicator" size={15} />
            </button>
          )}

          {view?.table && view.col && (
            <button
              type="button"
              title="ドラッグで移動 / クリックでメニュー"
              className="mg-grip mg-grip-hold mg-grip-bar"
              draggable
              style={{
                top: view.table.top - BAR - ADD_AWAY,
                left: view.col.left,
                width: view.col.width,
                height: BAR,
              }}
              onDragStart={hold("col", view.index, view.col.index, view.table)}
              onDragEnd={release}
              onClick={(e) =>
                setMenu({
                  kind: "col",
                  index: view.index,
                  at: view.col?.index ?? -1,
                  x: e.clientX,
                  y: e.clientY,
                })
              }
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({
                  kind: "col",
                  index: view.index,
                  at: view.col?.index ?? -1,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            >
              <Icon name="drag_indicator" size={15} className="rotate-90" />
            </button>
          )}

          {view?.table && (
            <>
              {view.atRight && (
                <button
                  type="button"
                  title="列を追加"
                  className="mg-grip mg-grip-bar mg-grip-add"
                  style={{
                    top: view.table.top,
                    left: view.table.left + view.table.width + ADD_AWAY,
                    width: ADD,
                    height: view.table.height,
                  }}
                  onClick={() => onTableAppend(view.index, "col")}
                >
                  <Icon name="add" size={14} />
                </button>
              )}
              <button
                type="button"
                title="行を追加"
                className="mg-grip mg-grip-bar mg-grip-add"
                style={{
                  top: view.bottom + ADD_AWAY,
                  left: view.table.left,
                  width: view.table.width,
                  height: ADD,
                }}
                onClick={() => onTableAppend(view.index, "row")}
              >
                <Icon name="add" size={14} />
              </button>
            </>
          )}

          {/* 何に対するメニューかを塗って示す。メニューへ動かすと表から
              離れるので、印が無いとどの行・列だったか分からなくなる。 */}
          {menu?.kind === "block" && view?.box && (
            <div className="mg-target" style={view.box} />
          )}
          {menu?.kind === "item" && view?.item && (
            <div className="mg-target" style={view.item.box} />
          )}
          {(menu?.kind === "row" || holding === "row") &&
            view?.table &&
            view.row && (
              <div
                className="mg-target"
                style={{
                  top: view.row.top,
                  left: view.table.left,
                  width: view.table.width,
                  height: view.row.height,
                }}
              />
            )}
          {(menu?.kind === "col" || holding === "col") &&
            view?.table &&
            view.col && (
              <div
                className="mg-target"
                style={{
                  top: view.table.top,
                  left: view.col.left,
                  width: view.col.width,
                  height: view.table.height,
                }}
              />
            )}

          {guide && (
            <div
              className={guide.kind === "col" ? "mg-guide-v" : "mg-guide-h"}
              style={
                guide.kind === "col"
                  ? { top: guide.top, left: guide.left, height: guide.length }
                  : { top: guide.top, left: guide.left, width: guide.length }
              }
            />
          )}
        </div>,
        content,
      )}

      {menu &&
        createPortal(
          <div
            ref={menuBox}
            style={{
              left: Math.min(menu.x, window.innerWidth - 190),
              top: Math.min(
                menu.y,
                window.innerHeight - items.length * 32 - 20,
              ),
            }}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-50 w-[11.5rem] rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] p-1.5 shadow-2xl"
          >
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                onClick={() => {
                  it.run();
                  setMenu(null);
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition hover:bg-[var(--mg-hover)] ${
                  it.danger
                    ? "text-[var(--mg-danger)]"
                    : "text-[var(--mg-fg-dim)]"
                }`}
              >
                <Icon
                  name={it.icon}
                  size={16}
                  className={it.danger ? "" : "text-[var(--mg-muted)]"}
                />
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      {menu && <Dismiss box={menuBox} onClose={() => setMenu(null)} />}
    </>
  );
}

// メニューの外を押した／Esc で閉じる。
//
// 見張るのは click ではなく mousedown。click で見張ると、メニューを開いた
// その 1 回のクリックがそのまま「外側を押した」として届き、開いた瞬間に
// 閉じてしまう（左クリックでメニューが出ないのはこれが原因だった）。
function Dismiss({
  box,
  onClose,
}: {
  box: React.RefObject<HTMLDivElement>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      onClose();
    };
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [box, onClose]);
  return null;
}

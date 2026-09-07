import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { blockIndexOf, blockRect, topmostBlock } from "../lib/domText";
import { setDragPreview, setDragTablePart } from "../lib/dragImage";
import {
  ADD,
  ADD_AWAY,
  AWAY,
  BOTH,
  BAR,
  EDGE,
  GRIP,
  itemAtY,
  itemEdge,
  itemLine,
  lineHeight,
  ONLY,
  relative,
  tableBands,
  tableGeometry,
  type Box,
  addBelow,
  HOLD,
  HOLD_GAP,
  holdAt,
  onLine,
  roomBelow,
} from "../lib/gutterGeom";
import { BlockMenu, type MenuItem } from "./BlockMenu";
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

const BLOCK_MIME = "application/x-fude-block";
const ROW_MIME = "application/x-fude-trow";
const COL_MIME = "application/x-fude-tcol";


interface View {
  index: number;
  atRight: boolean;
  bottom: number;
  // 表の下に足すつまみを置ける高さ（次のブロックとの空き）。
  below: number;
  // 非表のブロックの外枠。メニューの対象を塗るのに使う。
  box: Box | null;
  // 箇条書きの項目。Markdown ではリスト全体が 1 ブロックだが、掴む単位は項目。
  item: {
    at: number;
    top: number;
    height: number;
    // 1 行目の真ん中。つまみはここに合わせる（項目全体の真ん中だと、
    // 2 行以上の項目で行の間に落ちる）。
    mid: number;
    // 項目の左端（記号を含む）。つまみはここから左へ置く。
    edge: number;
    box: Box;
  } | null;
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

const ITEM_MIME = "application/x-fude-item";

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
    a.below === b.below &&
    (a.box?.top ?? -1) === (b.box?.top ?? -1) &&
    (a.item?.at ?? -1) === (b.item?.at ?? -1) &&
    Math.abs(a.y - b.y) < 0.5 &&
    (a.row?.line ?? -1) === (b.row?.line ?? -1) &&
    (a.col?.index ?? -1) === (b.col?.index ?? -1) &&
    (a.table?.top ?? -1) === (b.table?.top ?? -1)
  );
}

// 相手のブロックは縦位置から決める。当たり判定で拾うと、重ねた層や指摘の印、
// 本文の外の余白で相手を見失う。
// 指している高さの項目。入れ子は内側（背の低い方）が勝つ。
// 当たり判定で拾うと、余白に出た瞬間に相手を見失う。
// 要素の 1 行目の箱。行の高さを読むより確実で、チェックボックスの行送りや
// 項目の余白に引っ張られない。

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

// 表のつまみの相手は、その表の DOM から測る。行の数え方はモードで違うので
// 候補の行を渡す形になっている（読むときは見出しが <thead> に入る）。
function geometryOf(blockEl: Element, x: number, y: number, base: DOMRect) {
  const table = blockEl.querySelector("table");
  if (!table) return null;
  const rows = Array.from(table.tBodies[0]?.rows ?? []);
  const geo = tableGeometry(table, rows, { x, y }, base);
  if (!geo) return null;
  // GFM の表はソースの 1 行が 1 つの tr になる。本体は 2 行目から
  // （0 行目が見出し、1 行目が区切り）。
  return {
    ...geo,
    row: geo.row ? { ...geo.row, line: geo.row.index + 2 } : null,
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
  onItemEdit,
  onItemComment,
  onCellEdit,
  onCellComment,
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
  // 項目の中身をその場で編集する。
  onItemEdit: (index: number, at: number) => void;
  // 項目そのものへの指摘。
  onItemComment: (index: number, at: number) => void;
  // 表のセル。at はセルの中身が始まるソース上の位置（描画側が持つ目印）。
  // 空のセルは選ぶ文字が無く、選択からは入れないのでここから開く。
  onCellEdit: (index: number, at: number) => void;
  onCellComment: (index: number, at: number) => void;
  // その位置が箇条書きの何行目の項目か。無ければ null。
  itemAt: (
    index: number,
    offset: number,
  ) => { from: number; to: number } | null;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  // 何のメニューか。ブロックのつまみは項目一式、行・列は削除だけ。
  const [menu, setMenu] = useState<{
    kind: Kind | "cell";
    index: number;
    at: number;
    x: number;
    y: number;
  } | null>(null);
  const viewRef = useRef<View | null>(null);
  // 最後に指していた場所。中身の高さが変わったときに測り直すのに使う。
  const atRef = useRef<{ x: number; y: number } | null>(null);
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
  // 掴んでいるあいだ薄くしている実体。離すときに元へ戻す。
  const liftedRef = useRef<Element[]>([]);
  const liftRafRef = useRef(0);
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

    // 指している場所から出すものを決める。中身の高さが変わったときにも
    // 同じ場所で測り直せるよう、座標を引数で受ける。
    const measure = (x: number, y: number, target: Node | null) => {
      if (heldRef.current || menuRef.current) return;
      // つまみの上に来ても保つ。消えると押せない。
      if (target && layerRef.current?.contains(target)) return;
      const hit = blockAtY(content, y);
      // 本文の外（上下の余白）では直前の相手を保つ。
      if (!hit) return;

      const base = content.getBoundingClientRect();
      // 表のつまみは表の外側（左と上）に置く。そこへ向かう途中で表から離れると
      // 相手が別のブロックに変わって消えてしまうので、少し外まで表として扱う。
      const held = viewRef.current?.table;
      if (held && !isTable(hit.index)) {
        const pad = GRIP + AWAY + 4;
        const near =
          x >= base.left + held.left - pad &&
          x <= base.left + held.left + held.width + pad &&
          y >= base.top + held.top - pad &&
          y <= base.top + held.top + held.height + pad;
        if (near) return;
      }
      const room = scroller
        ? base.left - scroller.getBoundingClientRect().left
        : BOTH;
      const geo = isTable(hit.index) ? geometryOf(hit.el, x, y, base) : null;

      if (geo) {
        // 行は左の縁、列は上の縁を指したときだけ出す。表の内側どこでも出すと
        // 常に付いて回って読みにくい。外の帯の上も同じ判定で通る。
        const onLeft = x <= base.left + geo.table.left + EDGE;
        const onTop = y <= base.top + geo.table.top + EDGE;
        const next: View = {
          index: hit.index,
          y: 0,
          room,
          atRight: geo.atRight,
          bottom: geo.bottom,
          below: roomBelow(content, hit.index, hit.el),
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
      const li = itemAtY(hit.el, y, "li[data-mg-item]");
      const anchorAt = numberOf(li, "mgItem");
      const found =
        li && anchorAt !== null ? itemAt(hit.index, anchorAt) : null;
      const liBox = li ? li.getBoundingClientRect() : null;
      const next: View = {
        index: hit.index,
        atRight: true,
        bottom: 0,
        below: 0,
        box: relative(box, base),
        item:
          found && liBox && li
            ? {
                at: found.from,
                top: liBox.top - base.top,
                height: liBox.height,
                mid: itemLine(li, liBox).top - base.top + itemLine(li, liBox).height / 2,
                edge: itemEdge(li) - base.left,
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

    const onMouseMove = (e: MouseEvent) => {
      // 選択を引いているあいだは出さない。押せるものが下に出ると、ドラッグの
      // 行き先をそれが奪って選択が飛ぶ。
      if (e.buttons !== 0) return;
      atRef.current = { x: e.clientX, y: e.clientY };
      measure(e.clientX, e.clientY, e.target as Node | null);
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
        const li = hit && hit.index === held.index ? itemAtY(hit.el, e.clientY, "li[data-mg-item]") : null;
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
          ? geometryOf(hit.el, e.clientX, e.clientY, base)
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
      unlift();
      if (!held || to === null) return;
      e.preventDefault();
      if (held.kind === "block") onMove(held.at, to);
      else if (held.kind === "item") onItemMove(held.index, held.at, to);
      else onTableMove(held.index, held.kind, held.at, to);
    };

    // 表は枠の中で横へスクロールする。列の位置が変わっても入れ物の大きさは
    // 変わらないので、大きさの見張りでは気付けない。scroll は上がってこない
    // ので捕まえる側で拾う。
    //
    // ここで相手を選び直さない。手は動いていないし、メニューを開いている間は
    // 何行目・何列目が決まっている。置き場所だけを測り直す（測り直さないと
    // 塗りだけが表と別に動いて、選んでいる場所からずれていく）。
    const onScroll = (e: Event) => {
      const from = e.target instanceof Element ? e.target : null;
      if (!from?.closest(".mg-table-wrap")) return;
      const held = viewRef.current;
      if (!held?.table) return;
      const blockEl = content.querySelector(`[data-mg-block="${held.index}"]`);
      const el = blockEl?.querySelector("table");
      if (!el) return;
      const geo = tableBands(
        el,
        Array.from(el.tBodies[0]?.rows ?? []),
        {
          // 行の相手はソースの行番号で持っている（本体は 2 行目から）。
          row: held.row ? held.row.line - 2 : null,
          col: held.col?.index ?? null,
        },
        content.getBoundingClientRect(),
      );
      if (!geo) return;
      show({
        ...held,
        atRight: geo.atRight,
        bottom: geo.bottom,
        below: roomBelow(content, held.index, null),
        table: geo.table,
        row: geo.row ? { line: geo.row.index + 2, top: geo.row.top, height: geo.row.height } : null,
        col: geo.col,
      });
    };

    // 右押しでセルのメニューを出す。空のセルは選ぶ文字が無いので、
    // 選択から入る道（⌘E・⌘⇧I）が使えない。ここが唯一の入口になる。
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const cell = target?.closest<HTMLElement>("[data-mg-cell]") ?? null;
      if (!cell) return;
      const blockEl = cell.closest<HTMLElement>("[data-mg-block]");
      const index = blockEl ? Number(blockEl.dataset.mgBlock) : NaN;
      const at = Number(cell.dataset.mgCell);
      if (!Number.isInteger(index) || !Number.isInteger(at)) return;
      e.preventDefault();
      setMenu({ kind: "cell", index, at, x: e.clientX, y: e.clientY });
    };

    // 中身の高さが変わると、出したままの帯は前の位置に取り残される（行を足すと
    // 表が下へ伸び、足す帯が新しい行に重なる）。最後に指していた場所で測り
    // 直す。大きさが変わっていない知らせでは何もしない（描き直しと測り直しが
    // 互いを呼び合うのを避ける）。掴んでいる間は動かさない。
    let seen = { w: 0, h: 0 };
    const settle = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      if (Math.abs(box.width - seen.w) < 1 && Math.abs(box.height - seen.h) < 1) {
        return;
      }
      seen = { w: box.width, h: box.height };
      if (heldRef.current) return;
      const at = atRef.current;
      if (at) measure(at.x, at.y, null);
    });
    settle.observe(content);

    host.addEventListener("mousemove", onMouseMove);
    host.addEventListener("mouseleave", onMouseLeave);
    host.addEventListener("scroll", onScroll, true);
    host.addEventListener("dragover", onDragOver);
    host.addEventListener("drop", onDrop);
    host.addEventListener("contextmenu", onContextMenu);
    return () => {
      host.removeEventListener("mousemove", onMouseMove);
      host.removeEventListener("mouseleave", onMouseLeave);
      host.removeEventListener("scroll", onScroll, true);
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("drop", onDrop);
      host.removeEventListener("contextmenu", onContextMenu);
      settle.disconnect();
    };
  }, [content, scroller, isTable, onMove, onTableMove]);

  if (!content) return null;

  const hold =
    (kind: Kind, index: number, at: number, box: Box | null = null) =>
    (e: React.DragEvent) => {
      heldRef.current = { kind, index, at, box };
      e.dataTransfer.setData(MIME[kind], String(at));
      e.dataTransfer.effectAllowed = "move";
      // 掴んだものを薄い写しで見せる。大きすぎるときは名前の札に落ちる。
      if (kind === "col" || kind === "row") {
        setDragTablePart(
          e.dataTransfer,
          content
            .querySelector(`[data-mg-block="${index}"]`)
            ?.querySelector("table") ?? null,
          kind,
          // 行はソースの行番号で持っている（本体は 2 行目から）。写しは
          // table.rows で数えるので、見出しの 1 行ぶんだけ戻す。
          kind === "row" ? at - 1 : at,
          label(kind, index),
        );
      } else {
        setDragPreview(e.dataTransfer, previewOf(kind, index, at), label(kind, index));
      }
      lift(heldParts(kind, index, at));
      setMenu(null);
    };

  // 写しに使う要素。ブロックはその中身、表は掴んだ行。
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
  // 掴んだものを薄くして、持ち上がったことをその場で見せる。元の位置に濃いまま
  // 残っていると動いている実感が無いので、別に囲みを描いて示す必要が出る。
  const lift = (els: (Element | null | undefined)[]) => {
    const found = els.filter((el): el is Element => !!el);
    // 写しは setDragImage の時点で取られる。薄くするのはその後の一枚から。
    // 掴んですぐ離したときは、この一枚が来る前に取り消す（薄いまま残る）。
    liftRafRef.current = requestAnimationFrame(() => {
      liftedRef.current = found;
      for (const el of found) el.classList.add("mg-lifting");
    });
  };

  const unlift = () => {
    cancelAnimationFrame(liftRafRef.current);
    for (const el of liftedRef.current) el.classList.remove("mg-lifting");
    liftedRef.current = [];
  };

  // 薄くする対象。ブロックと項目はその実体、表は掴んだ行・列の升目。
  const heldParts = (kind: Kind, index: number, at: number): (Element | null)[] => {
    if (kind === "block" || kind === "item") return [previewOf(kind, index, at)];
    const table = content
      .querySelector(`[data-mg-block="${index}"]`)
      ?.querySelector("table");
    if (!table) return [];
    const rows = Array.from(table.rows);
    // 行はソースの行番号で持っている（本体は 2 行目から）。
    if (kind === "row") return [rows[at - 1] ?? null];
    return rows.map((row) => row.cells[at] ?? null);
  };

  const release = () => {
    unlift();
    heldRef.current = null;
    toRef.current = null;
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
      {
        icon: "add_comment",
        label: "指摘する",
        keys: "⌘⇧I",
        run: () => onItemComment(index, at),
      },
      {
        icon: "edit",
        label: "編集する",
        keys: "⌘E",
        run: () => onItemEdit(index, at),
      },
      { icon: "arrow_upward", label: "上に挿入", run: act("insertBefore") },
      { icon: "arrow_downward", label: "下に挿入", run: act("insertAfter") },
      { icon: "content_copy", label: "複製", run: act("duplicate") },
      { icon: "delete", label: "削除", run: act("delete"), danger: true },
    ];
  };

  // 表のセルのメニュー。右押しで出す。空のセルへ入る唯一の道でもある。
  const cellItems = (index: number, at: number): MenuItem[] => [
    {
      icon: "add_comment",
      label: "指摘する",
      keys: "⌘⇧I",
      run: () => onCellComment(index, at),
    },
    {
      icon: "edit",
      label: "編集する",
      keys: "⌘E",
      run: () => onCellEdit(index, at),
    },
  ];

  const items =
    menu === null
      ? []
      : menu.kind === "cell"
        ? cellItems(menu.index, menu.at)
        : menu.kind === "item"
        ? itemItems(menu.index, menu.at)
        : menu.kind !== "block"
          ? partItems(menu.kind, menu.index, menu.at)
        : [
            {
              icon: "add_comment",
              label: "指摘する",
              keys: "⌘⇧I",
              run: () => onComment(menu.index),
            },
            {
              icon: "edit",
              label: "編集する",
              keys: "⌘E",
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
  // 使える幅。箇条書きは項目の左端から測る（字下げの分だけ余裕がある）。
  const room = view ? view.room + (view.item ? view.item.edge : 0) : 0;
  const wide = !!view && room >= BOTH;
  // 非表のつまみの置き場所。表は行・列の帯の交点（下で別に置く）。
  // 箇条書きは項目の 1 行目に高さを合わせ、左は項目の左端に寄せる。本文の
  // 左端に合わせると、字下げの分だけ離れて見える。
  const anchor =
    view && !view.table
      ? {
          top: (view.item ? view.item.mid : view.y) - GRIP / 2,
          left:
            (view.item ? view.item.edge : 0) +
            (room >= ONLY ? -(wide ? BOTH : ONLY) : 2),
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
                  title={view.item ? "下に項目を挿入" : "下に挿入"}
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
                title={
                  view.item
                    ? "ドラッグで項目を移動 / クリックでメニュー"
                    : "ドラッグで移動 / クリックでメニュー"
                }
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
                top: view.table.top,
                left: view.table.left - GRIP - HOLD_GAP,
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
                top: holdAt(view.row.top, view.row.height),
                left: onLine(view.table.left, BAR),
                width: BAR,
                height: HOLD,
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
                top: onLine(view.table.top, BAR),
                left: holdAt(view.col.left, view.col.width),
                width: HOLD,
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
                  top: addBelow(view.bottom, view.below, ADD_AWAY),
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
          {menu?.kind === "row" &&
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
          {menu?.kind === "col" &&
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

      {menu && (
        <BlockMenu
          x={menu.x}
          y={menu.y}
          items={items}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

// メニューの外を押した／Esc で閉じる。
//
// 見張るのは click ではなく mousedown。click で見張ると、メニューを開いた
// その 1 回のクリックがそのまま「外側を押した」として届き、開いた瞬間に
// 閉じてしまう（左クリックでメニューが出ないのはこれが原因だった）。

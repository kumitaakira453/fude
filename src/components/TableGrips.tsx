import type { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { setDragColumn, setDragPreview } from "../lib/dragImage";
import { schema } from "../lib/md/schema";
import {
  tableActTr,
  tableMoveTr,
  type TableAct,
  type TablePart,
} from "../lib/md/tableActs";
import {
  ADD,
  ADD_AWAY,
  BAR,
  EDGE,
  GRIP,
  tableBands,
  tableGeometry,
  type Box,
  type TableGeometry,
} from "../lib/tableGeom";
import { BlockMenu, type MenuItem } from "./BlockMenu";
import { Icon } from "./Icon";

// 編集面の表の行・列のつまみ。
//
// 読むとき側（BlockGutter）と同じ見た目・同じ並びで、相手が編集モデルの位置に
// なる。組版は動かさない。位置を測って層を重ねるだけ。
//
// 層は編集面の中には置かない。ProseMirror は自分の DOM の変化を見ていて、
// React が要素を差し込むとそれを本文の書き換えと取り違える。入れ物（host）の
// 側に置き、編集面とは兄弟にする。

const ROW_MIME = "application/x-fude-pmrow";
const COL_MIME = "application/x-fude-pmcol";
const MIME: Record<TablePart, string> = { row: ROW_MIME, col: COL_MIME };

interface Spot {
  // 表の節点の位置。
  pos: number;
  rows: number;
  cols: number;
  geo: TableGeometry;
}

interface Guide {
  kind: TablePart;
  top: number;
  left: number;
  length: number;
}

const sameBox = (a: Box, b: Box) =>
  a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

function same(a: Spot | null, b: Spot | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.pos === b.pos &&
    a.rows === b.rows &&
    a.cols === b.cols &&
    sameBox(a.geo.table, b.geo.table) &&
    a.geo.atRight === b.geo.atRight &&
    a.geo.bottom === b.geo.bottom &&
    a.geo.row?.index === b.geo.row?.index &&
    a.geo.row?.top === b.geo.row?.top &&
    a.geo.col?.index === b.geo.col?.index &&
    a.geo.col?.left === b.geo.col?.left
  );
}

// つまみへ手が届く範囲。表の外側に置いた帯（掴む帯・足す帯）まで含める。
const REACH = ADD + ADD_AWAY + 6;

// 追加の帯を表から離す幅。表の枠と重ならないよう、読むとき側より広く取る
// （編集面では升目に焦点の枠が付くので、詰めると枠に重なって見える）。
const ADD_GAP = 12;

// 指している高さにある表。当たり判定だけでは足りない。
//
// つまみは表の外側（左・上・右・下）に置くので、そこへ手を伸ばしている間は
// 表の上に居ない。ブロックは縦に並んでいて上端が昇順なので、その高さの
// ブロックを二分探索で挟む（上から順に測ると本文の大きさに比例して遅くなる）。
function tableNear(view: EditorView, y: number): HTMLTableElement | null {
  const kids = view.dom.children;
  if (!kids.length) return null;
  let lo = 0;
  let hi = kids.length - 1;
  let at = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (kids[mid].getBoundingClientRect().top <= y) {
      at = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // 挟んだブロックと、その次。ブロックの間の余白では次の方が近い。
  for (const i of [at, at + 1]) {
    const el = kids[i];
    if (!el) continue;
    const box = el.getBoundingClientRect();
    if (y < box.top - REACH || y > box.bottom + REACH) continue;
    const table = el.querySelector("table");
    if (table) return table;
  }
  return null;
}

// その表の節点の位置。行から辿るので、表そのものを指していなくても当たる。
function tablePosOf(view: EditorView, el: HTMLTableElement): number | null {
  const from = el.rows[0] ?? el;
  let at: number;
  try {
    at = view.posAtDOM(from, 0);
  } catch {
    return null;
  }
  if (at < 0) return null;
  const $at = view.state.doc.resolve(Math.min(at, view.state.doc.content.size));
  for (let d = $at.depth; d > 0; d--) {
    if ($at.node(d).type === schema.nodes.table) return $at.before(d);
  }
  return null;
}

export function TableGrips({
  view,
  host,
  scroller,
}: {
  view: EditorView;
  host: HTMLElement;
  scroller: HTMLElement | null;
}) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [menu, setMenu] = useState<{
    kind: TablePart;
    pos: number;
    at: number;
    x: number;
    y: number;
  } | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [holding, setHolding] = useState<TablePart | null>(null);

  const layer = useRef<HTMLDivElement>(null);
  // 出しているものは描き直しを待たずに読みたい（測る側は React の外に居る）。
  const spotRef = useRef<Spot | null>(null);
  const menuRef = useRef(false);
  const heldRef = useRef<{ kind: TablePart; pos: number; at: number } | null>(null);
  const toRef = useRef<number | null>(null);
  // 最後に指していた場所。中身が動いたとき、そこで測り直す。
  const atRef = useRef<{ x: number; y: number } | null>(null);
  // 最後に指していた場所で測り直す口。行や列を足した直後にも使う。
  const againRef = useRef<(() => void) | null>(null);
  spotRef.current = spot;
  menuRef.current = menu !== null;

  useEffect(() => {
    // 見張るのはスクロール枠。つまみは本文の外の余白に置くので、編集面の要素
    // だけを見ていると、そこへ手を伸ばした時点で編集面から出たことになり
    // （mouseleave が走る）触る前に消える。余白に直接入ってきた時にも
    // 何も起きない。
    const watching = scroller ?? host;

    const show = (next: Spot | null) => {
      if (!same(spotRef.current, next)) {
        spotRef.current = next;
        setSpot(next);
      }
    };

    // keep を落とすと、つまみの上を指していても測り直す。表の形が変わったとき
    // （行や列を足した直後）は、つまみが指の下に来ているので保つ側に回ると
    // 古い置き場所のまま残り、表に重なって見える。
    const measure = (x: number, y: number, target: Node | null, keep = true) => {
      if (heldRef.current || menuRef.current) return;
      // つまみの上に来ても保つ。消えると押せない。
      if (keep && target && layer.current?.contains(target)) return;
      const inside =
        target instanceof Element ? target.closest<HTMLTableElement>("table") : null;
      const el =
        inside && view.dom.contains(inside) ? inside : tableNear(view, y);
      if (!el || !view.dom.contains(el)) {
        // 出しているつまみの近くなら保つ。表とつまみの隙間を通る間に
        // 消えると、そこへ手を伸ばせない。
        const held = spotRef.current?.geo.table;
        if (held) {
          const box = host.getBoundingClientRect();
          const pad = GRIP + ADD + ADD_AWAY;
          const near =
            x >= box.left + held.left - pad &&
            x <= box.left + held.left + held.width + pad &&
            y >= box.top + held.top - pad &&
            y <= box.top + held.top + held.height + pad;
          if (near) return;
        }
        show(null);
        return;
      }
      const pos = tablePosOf(view, el);
      const table = pos === null ? null : view.state.doc.nodeAt(pos);
      if (pos === null || !table) {
        show(null);
        return;
      }
      const base = host.getBoundingClientRect();
      const geo = tableGeometry(el, Array.from(el.rows), { x, y }, base);
      if (!geo) {
        show(null);
        return;
      }
      // 行は左の縁、列は上の縁を指したときだけ出す。表の内側どこでも出すと
      // 常に付いて回って読みにくい。
      const onLeft = x <= base.left + geo.table.left + EDGE;
      const onTop = y <= base.top + geo.table.top + EDGE;
      show({
        pos,
        rows: table.childCount,
        cols: table.child(0)?.childCount ?? 0,
        geo: {
          ...geo,
          // 1 行目は見出し。GFM の表では動かせず消せないので帯を出さない。
          row: onLeft && geo.row && geo.row.index > 0 ? geo.row : null,
          col: onTop ? geo.col : null,
        },
      });
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

    // 落とす先を決める。掴んでいる間だけ本文へ渡さない（ProseMirror の
    // 取り込みが走ると、掴んだ帯の代わりに文字が動く）。
    const onDragOver = (e: DragEvent) => {
      const held = heldRef.current;
      if (!held || !e.dataTransfer?.types.includes(MIME[held.kind])) return;
      const el = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLTableElement>("table");
      if (!el || !view.dom.contains(el) || tablePosOf(view, el) !== held.pos) return;
      const base = host.getBoundingClientRect();
      const geo = tableGeometry(el, Array.from(el.rows), { x: e.clientX, y: e.clientY }, base);
      if (!geo) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";

      if (held.kind === "row") {
        const row = geo.row;
        // 見出しの上へは運ばせない。
        if (!row || row.index < 1) return;
        const after = e.clientY > base.top + row.top + row.height / 2;
        toRef.current = after ? row.index + 1 : row.index;
        setGuide({
          kind: "row",
          top: row.top + (after ? row.height : 0),
          left: geo.table.left,
          length: geo.table.width,
        });
        return;
      }
      const col = geo.col;
      if (!col) return;
      const after = e.clientX > base.left + col.left + col.width / 2;
      toRef.current = after ? col.index + 1 : col.index;
      setGuide({
        kind: "col",
        top: geo.table.top,
        left: col.left + (after ? col.width : 0),
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
      e.stopPropagation();
      const tr = tableMoveTr(view.state, held.pos, held.kind, held.at, to);
      if (tr) view.dispatch(tr);
    };

    const again = () => {
      const at = atRef.current;
      if (at) measure(at.x, at.y, document.elementFromPoint(at.x, at.y), false);
    };
    againRef.current = again;

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
      const held = spotRef.current;
      if (!held) return;
      const dom = view.nodeDOM(held.pos);
      const el = dom instanceof HTMLElement ? dom.querySelector("table") : null;
      if (!el) return;
      const geo = tableBands(
        el,
        Array.from(el.rows),
        { row: held.geo.row?.index ?? null, col: held.geo.col?.index ?? null },
        host.getBoundingClientRect(),
      );
      if (geo) show({ ...held, geo });
    };

    // 行を足すと表が下へ伸びる。出したままの帯は前の位置に取り残されるので、
    // 最後に指していた場所で測り直す。掴んでいる間は動かさない。
    let seen = { w: 0, h: 0 };
    const settle = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      if (Math.abs(box.width - seen.w) < 1 && Math.abs(box.height - seen.h) < 1) return;
      seen = { w: box.width, h: box.height };
      if (heldRef.current) return;
      again();
    });
    settle.observe(view.dom);

    watching.addEventListener("mousemove", onMouseMove);
    watching.addEventListener("mouseleave", onMouseLeave);
    watching.addEventListener("scroll", onScroll, true);
    // 掴んでいる間の合図は、本文へ届く前に受け取る。
    watching.addEventListener("dragover", onDragOver, true);
    watching.addEventListener("drop", onDrop, true);
    return () => {
      againRef.current = null;
      watching.removeEventListener("mousemove", onMouseMove);
      watching.removeEventListener("mouseleave", onMouseLeave);
      watching.removeEventListener("scroll", onScroll, true);
      watching.removeEventListener("dragover", onDragOver, true);
      watching.removeEventListener("drop", onDrop, true);
      settle.disconnect();
    };
  }, [view, host, scroller]);

  const run = (kind: TablePart, pos: number, at: number, act: TableAct) => {
    const tr = tableActTr(view.state, pos, kind, at, act);
    if (tr) view.dispatch(tr);
    view.focus();
    // 表の形が変わったので置き場所を測り直す。組版が終わった次の一枚で測る。
    requestAnimationFrame(() => againRef.current?.());
  };

  const hold =
    (kind: TablePart, pos: number, at: number) => (e: React.DragEvent) => {
      heldRef.current = { kind, pos, at };
      setHolding(kind);
      e.dataTransfer.setData(MIME[kind], String(at));
      e.dataTransfer.effectAllowed = "move";
      if (kind === "col") {
        setDragColumn(e.dataTransfer, columnCells(at), "列を移動");
      } else {
        setDragPreview(e.dataTransfer, tableOf()?.rows[at] ?? null, "行を移動");
      }
      setMenu(null);
    };

  // 出しているつまみの表。
  const tableOf = (): HTMLTableElement | null => {
    const dom = view.nodeDOM(spot?.pos ?? -1);
    return dom instanceof HTMLElement ? dom.querySelector("table") : null;
  };

  // その列の升目を上から。掴んだときの写しに使う。
  const columnCells = (at: number): HTMLElement[] => {
    const table = tableOf();
    if (!table) return [];
    const out: HTMLElement[] = [];
    for (const row of table.rows) {
      const cell = row.cells[at];
      if (cell) out.push(cell);
    }
    return out;
  };

  const release = () => {
    heldRef.current = null;
    toRef.current = null;
    setHolding(null);
    setGuide(null);
  };

  // 行・列のメニュー。並びは読むとき側と同じ。
  const items = (kind: TablePart, pos: number, at: number): MenuItem[] => {
    const act = (a: TableAct) => () => run(kind, pos, at, a);
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

  const geo = spot?.geo;

  return (
    <>
      {createPortal(
        <div ref={layer} className="mg-block-layer not-prose">
          {geo?.row && spot && (
            <button
              type="button"
              title="ドラッグで移動 / クリックでメニュー"
              className="mg-grip mg-grip-hold mg-grip-bar"
              draggable
              style={{
                top: geo.row.top,
                left: geo.table.left - BAR - ADD_AWAY,
                width: BAR,
                height: geo.row.height,
              }}
              onDragStart={hold("row", spot.pos, geo.row.index)}
              onDragEnd={release}
              onClick={(e) =>
                setMenu({
                  kind: "row",
                  pos: spot.pos,
                  at: geo.row?.index ?? -1,
                  x: e.clientX,
                  y: e.clientY,
                })
              }
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({
                  kind: "row",
                  pos: spot.pos,
                  at: geo.row?.index ?? -1,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            >
              <Icon name="drag_indicator" size={15} />
            </button>
          )}

          {geo?.col && spot && (
            <button
              type="button"
              title="ドラッグで移動 / クリックでメニュー"
              className="mg-grip mg-grip-hold mg-grip-bar"
              draggable
              style={{
                top: geo.table.top - BAR - ADD_AWAY,
                left: geo.col.left,
                width: geo.col.width,
                height: BAR,
              }}
              onDragStart={hold("col", spot.pos, geo.col.index)}
              onDragEnd={release}
              onClick={(e) =>
                setMenu({
                  kind: "col",
                  pos: spot.pos,
                  at: geo.col?.index ?? -1,
                  x: e.clientX,
                  y: e.clientY,
                })
              }
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({
                  kind: "col",
                  pos: spot.pos,
                  at: geo.col?.index ?? -1,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            >
              <Icon name="drag_indicator" size={15} className="rotate-90" />
            </button>
          )}

          {geo && spot && (
            <>
              {geo.atRight && (
                <button
                  type="button"
                  title="列を追加"
                  className="mg-grip mg-grip-bar mg-grip-add"
                  style={{
                    top: geo.table.top,
                    left: geo.table.left + geo.table.width + ADD_GAP,
                    width: ADD,
                    height: geo.table.height,
                  }}
                  onClick={() => run("col", spot.pos, spot.cols - 1, "insertAfter")}
                >
                  <Icon name="add" size={14} />
                </button>
              )}
              <button
                type="button"
                title="行を追加"
                className="mg-grip mg-grip-bar mg-grip-add"
                style={{
                  top: geo.bottom + ADD_GAP,
                  left: geo.table.left,
                  width: geo.table.width,
                  height: ADD,
                }}
                onClick={() => run("row", spot.pos, spot.rows - 1, "insertAfter")}
              >
                <Icon name="add" size={14} />
              </button>
            </>
          )}

          {/* 何に対するメニューかを塗って示す。メニューへ動かすと表から
              離れるので、印が無いとどの行・列だったか分からなくなる。 */}
          {(menu?.kind === "row" || holding === "row") && geo?.row && (
            <div
              className="mg-target"
              style={{
                top: geo.row.top,
                left: geo.table.left,
                width: geo.table.width,
                height: geo.row.height,
              }}
            />
          )}
          {(menu?.kind === "col" || holding === "col") && geo?.col && (
            <div
              className="mg-target"
              style={{
                top: geo.table.top,
                left: geo.col.left,
                width: geo.col.width,
                height: geo.table.height,
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
        host,
      )}

      {menu && (
        <BlockMenu
          x={menu.x}
          y={menu.y}
          items={items(menu.kind, menu.pos, menu.at)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

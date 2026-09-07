import type { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { setDragPreview } from "../lib/dragImage";
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
  // 最後に指していた場所。中身の高さが変わったとき、そこで測り直す。
  const atRef = useRef<{ x: number; y: number } | null>(null);
  spotRef.current = spot;
  menuRef.current = menu !== null;

  useEffect(() => {
    const show = (next: Spot | null) => {
      if (!same(spotRef.current, next)) {
        spotRef.current = next;
        setSpot(next);
      }
    };

    const measure = (x: number, y: number, target: Node | null) => {
      if (heldRef.current || menuRef.current) return;
      // つまみの上に来ても保つ。消えると押せない。
      if (target && layer.current?.contains(target)) return;
      const el =
        target instanceof Element ? target.closest<HTMLTableElement>("table") : null;
      if (!el || !view.dom.contains(el)) {
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

    // 行を足すと表が下へ伸びる。出したままの帯は前の位置に取り残されるので、
    // 最後に指していた場所で測り直す。掴んでいる間は動かさない。
    let seen = { w: 0, h: 0 };
    const settle = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      if (Math.abs(box.width - seen.w) < 1 && Math.abs(box.height - seen.h) < 1) return;
      seen = { w: box.width, h: box.height };
      if (heldRef.current) return;
      const at = atRef.current;
      if (at) measure(at.x, at.y, document.elementFromPoint(at.x, at.y));
    });
    settle.observe(view.dom);

    view.dom.addEventListener("mousemove", onMouseMove);
    view.dom.addEventListener("mouseleave", onMouseLeave);
    // 掴んでいる間の合図は、本文へ届く前に受け取る。
    host.addEventListener("dragover", onDragOver, true);
    host.addEventListener("drop", onDrop, true);
    return () => {
      view.dom.removeEventListener("mousemove", onMouseMove);
      view.dom.removeEventListener("mouseleave", onMouseLeave);
      host.removeEventListener("dragover", onDragOver, true);
      host.removeEventListener("drop", onDrop, true);
      settle.disconnect();
    };
  }, [view, host]);

  // 出したままスクロールすると置き場所がずれる。まとめて測り直す。
  useEffect(() => {
    if (!scroller) return;
    const off = () => {
      if (heldRef.current || menuRef.current) return;
      spotRef.current = null;
      setSpot(null);
    };
    scroller.addEventListener("scroll", off, { passive: true });
    return () => scroller.removeEventListener("scroll", off);
  }, [scroller]);

  const run = (kind: TablePart, pos: number, at: number, act: TableAct) => {
    const tr = tableActTr(view.state, pos, kind, at, act);
    if (tr) view.dispatch(tr);
    view.focus();
  };

  const hold =
    (kind: TablePart, pos: number, at: number) => (e: React.DragEvent) => {
      heldRef.current = { kind, pos, at };
      setHolding(kind);
      e.dataTransfer.setData(MIME[kind], String(at));
      e.dataTransfer.effectAllowed = "move";
      setDragPreview(
        e.dataTransfer,
        previewOf(kind, at),
        kind === "row" ? "行を移動" : "列を移動",
      );
      setMenu(null);
    };

  // 掴んだものの薄い写し。行はその行、列は見出しのセル。
  const previewOf = (kind: TablePart, at: number): Element | null => {
    const dom = view.nodeDOM(spot?.pos ?? -1);
    const table = dom instanceof HTMLElement ? dom.querySelector("table") : null;
    if (!table) return null;
    if (kind === "row") return table.rows[at] ?? null;
    return table.rows[0]?.cells[at] ?? null;
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
                    left: geo.table.left + geo.table.width + ADD_AWAY,
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
                  top: geo.bottom + ADD_AWAY,
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

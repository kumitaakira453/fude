import { useEffect, useRef, useState } from "react";
import { useLayerHost } from "../lib/layerHost";
import { createPortal } from "react-dom";
import { blockIndexOf, blockRect, topmostBlock } from "../lib/domText";
import {
  AWAY,
  GRIP,
  inWrap,
  itemAtY,
  itemEdge,
  itemLine,
  lineHeight,
  HEAD_ROW,
  ONLY,
  relative,
  tableBands,
  type Box,
  HOLD_GAP,
} from "../lib/gutterGeom";
import { BlockMenu, type MenuItem } from "./BlockMenu";
import { TableModal, tablePlain } from "./TableModal";
import { Icon } from "./Icon";

// 読む面のブロックのつまみ。押すと、そのブロック（箇条書きなら項目）への
// 指摘・表の拡大・リンクの写しを出す。書き換える操作は持たない（書くのは
// リアルタイム編集の面でやる）。
//
// 本文の DOM は書き換えない。位置を測って重ねるだけなので、つまみが出ても
// 組版は動かない（AnchorOverlay と同じ持ち方）。

interface View {
  index: number;
  // 非表のブロックの外枠。メニューの対象を塗るのに使う。
  box: Box | null;
  // 箇条書きの項目。Markdown ではリスト全体が 1 ブロックだが、指す単位は項目。
  item: {
    at: number;
    // 1 行目の真ん中。つまみはここに合わせる（項目全体の真ん中だと、
    // 2 行以上の項目で行の間に落ちる）。
    mid: number;
    // 項目の左端（記号を含む）。つまみはここから左へ置く。
    edge: number;
    box: Box;
  } | null;
  // 非表のとき: 1 行目の中心（本文の座標）。つまみをこの高さに揃える。
  y: number;
  // 左余白の広さ。狭い画面では本文に寄せて置く。
  room: number;
  // 表のときだけ。見えている範囲の表の箱。
  table: Box | null;
}

type Kind = "block" | "item";

// 同じ場所を指し続けている間は描き直さない。マウスを動かすだけで層を
// 組み直すと、大きな本文で目に見えて重くなる。
function same(a: View | null, b: View): boolean {
  return (
    !!a &&
    a.index === b.index &&
    a.room === b.room &&
    (a.box?.top ?? -1) === (b.box?.top ?? -1) &&
    (a.item?.at ?? -1) === (b.item?.at ?? -1) &&
    Math.abs(a.y - b.y) < 0.5 &&
    (a.table?.top ?? -1) === (b.table?.top ?? -1) &&
    (a.table?.left ?? -1) === (b.table?.left ?? -1)
  );
}

function numberOf(el: Element | null, key: string): number | null {
  const raw = (el as HTMLElement | null)?.dataset?.[key];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// 相手のブロックは縦位置から決める。当たり判定で拾うと、重ねた層や指摘の印、
// 本文の外の余白で相手を見失う。
function blockAtY(
  content: HTMLElement,
  y: number,
): { el: HTMLElement; index: number } | null {
  const el = topmostBlock(content, y);
  const index = el ? blockIndexOf(el) : null;
  return el && index !== null ? { el, index } : null;
}

// 表の箱。横に溢れる表は枠の中でスクロールするので、見えている範囲で切る。
function tableBoxOf(blockEl: Element, base: DOMRect): Box | null {
  const table = blockEl.querySelector("table");
  if (!table) return null;
  const rows = Array.from(table.tBodies[0]?.rows ?? []);
  return tableBands(table, rows, { row: null, col: null }, base)?.table ?? null;
}

export function BlockGutter({
  content,
  scroller,
  contentKey,
  isTable,
  onComment,
  onCopyLink,
  onItemComment,
  onCellComment,
  itemAt,
}: {
  content: HTMLElement | null;
  scroller: HTMLElement | null;
  // ファイルが変わったら測り直す。
  contentKey: string;
  // そのブロックが表そのものか。callout の中の表などは表として扱わない。
  isTable: (index: number) => boolean;
  onComment: (index: number) => void;
  // その塊を指すリンクを写す。
  onCopyLink: (index: number) => void;
  // 項目そのものへの指摘。at は記号がある行番号。
  onItemComment: (index: number, at: number) => void;
  // 表のセルへの指摘。at はセルの中身が始まるソース上の位置（描画側が持つ目印）。
  // 空のセルは選ぶ文字が無く、選択からは入れないのでここから開く。
  onCellComment: (index: number, at: number) => void;
  // その位置が箇条書きの何行目の項目か。無ければ null。
  itemAt: (
    index: number,
    offset: number,
  ) => { from: number; to: number } | null;
}) {
  // 層の置き場所。React が描いている入れ物へ直に差すと、ファイルを
  // 切り替えたときに片付けの順で落ちる（useLayerHost の説明）。
  const layerHost = useLayerHost(content ?? null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  // 大きく開いて見ている表（描き上がった姿を写したもの）。
  const [zoomed, setZoomed] = useState<string | null>(null);
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
  // メニューを開いている間は相手を変えない。素の listener からも読む。
  const menuRef = useRef<boolean>(false);
  menuRef.current = menu !== null;

  const show = (next: View | null) => {
    viewRef.current = next;
    setView(next);
  };

  useEffect(() => {
    show(null);
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
      if (menuRef.current) return;
      // つまみの上に来ても保つ。消えると押せない。
      if (target && layerRef.current?.contains(target)) return;
      const hit = blockAtY(content, y);
      // 本文の外（上下の余白）では直前の相手を保つ。
      if (!hit) return;

      const base = content.getBoundingClientRect();
      // 表のつまみは表の左上の外に置く。そこへ向かう途中で表から離れると
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
        : ONLY;
      const table = isTable(hit.index) ? tableBoxOf(hit.el, base) : null;

      if (table) {
        const next: View = { index: hit.index, y: 0, room, box: null, item: null, table };
        if (!same(viewRef.current, next)) show(next);
        return;
      }

      const box = blockRect(hit.el);
      if (!box) return;
      // 箇条書きは項目ごとに指す。指している高さの li から行番号を引く。
      // 囲みの中は囲みごと指させる（gutterGeom の inWrap）。
      const found0 = itemAtY(hit.el, y, "li[data-mg-item]");
      const li = found0 && inWrap(found0, hit.el) ? null : found0;
      const anchorAt = numberOf(li, "mgItem");
      const found =
        li && anchorAt !== null ? itemAt(hit.index, anchorAt) : null;
      const liBox = li ? li.getBoundingClientRect() : null;
      const next: View = {
        index: hit.index,
        box: relative(box, base),
        item:
          found && liBox && li
            ? {
                at: found.from,
                mid: itemLine(li, liBox).top - base.top + itemLine(li, liBox).height / 2,
                edge: itemEdge(li) - base.left,
                box: relative(liBox, base),
              }
            : null,
        // ブロックの上端から半行下げる。行箱を直に測ると、コールアウトのように
        // 中に別の箱を抱えるブロックで見当違いの行に付く。
        // 上端から 1 行ぶんまで。背の高い塊（表・絵）で真ん中に浮かせない。
        y: box.top - base.top + Math.min(lineHeight(hit.el), box.height, HEAD_ROW) / 2,
        room,
        table: null,
      };
      if (!same(viewRef.current, next)) show(next);
    };

    // 測るのは 1 フレームに 1 回、最後に指していた場所だけ。mousemove は
    // 1 フレームに何度も来るうえ、測るたびに本文のレイアウトを確定させる。
    let moveFrame = 0;
    let moveTarget: Node | null = null;
    const onMouseMove = (e: MouseEvent) => {
      // 選択を引いているあいだは出さない。押せるものが下に出ると、ドラッグの
      // 行き先をそれが奪って選択が飛ぶ。
      if (e.buttons !== 0) return;
      atRef.current = { x: e.clientX, y: e.clientY };
      moveTarget = e.target as Node | null;
      if (moveFrame) return;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0;
        const at = atRef.current;
        if (at) measure(at.x, at.y, moveTarget);
      });
    };

    const onMouseLeave = () => {
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      if (!menuRef.current) show(null);
    };

    // 表は枠の中で横へスクロールする。表の位置が変わっても入れ物の大きさは
    // 変わらないので、大きさの見張りでは気付けない。scroll は上がってこない
    // ので捕まえる側で拾い、つまみの置き場所だけを測り直す。
    const onScroll = (e: Event) => {
      const from = e.target instanceof Element ? e.target : null;
      if (!from?.closest(".mg-table-wrap")) return;
      const held = viewRef.current;
      if (!held?.table) return;
      const blockEl = content.querySelector(`[data-mg-block="${held.index}"]`);
      const table = blockEl ? tableBoxOf(blockEl, content.getBoundingClientRect()) : null;
      if (table) show({ ...held, table });
    };

    // 右押しでセルのメニューを出す。空のセルは選ぶ文字が無いので、
    // 選択から入る道（⌘⇧I）が使えない。ここが唯一の入口になる。
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

    // 中身の高さが変わると、出したままのつまみは前の位置に取り残される。最後に
    // 指していた場所で測り直す。大きさが変わっていない知らせでは何もしない
    // （描き直しと測り直しが互いを呼び合うのを避ける）。
    let seen = { w: 0, h: 0 };
    const settle = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      if (Math.abs(box.width - seen.w) < 1 && Math.abs(box.height - seen.h) < 1) {
        return;
      }
      seen = { w: box.width, h: box.height };
      const at = atRef.current;
      if (at) measure(at.x, at.y, null);
    });
    settle.observe(content);

    host.addEventListener("mousemove", onMouseMove);
    host.addEventListener("mouseleave", onMouseLeave);
    host.addEventListener("scroll", onScroll, true);
    host.addEventListener("contextmenu", onContextMenu);
    return () => {
      host.removeEventListener("mousemove", onMouseMove);
      host.removeEventListener("mouseleave", onMouseLeave);
      host.removeEventListener("scroll", onScroll, true);
      host.removeEventListener("contextmenu", onContextMenu);
      settle.disconnect();
      cancelAnimationFrame(moveFrame);
    };
  }, [content, scroller, isTable, itemAt]);

  if (!content) return null;

  // 表なら「拡大」。溢れていなくても出す（一覧から消えると、どこに
  // あったのか探し直すことになる）。
  const zoomItems = (index: number): MenuItem[] => {
    const table = content
      ?.querySelector(`[data-mg-block="${index}"]`)
      ?.querySelector("table");
    if (!table) return [];
    return [
      {
        icon: "zoom_out_map",
        label: "拡大",
        run: () => setZoomed(tablePlain(table)),
      },
    ];
  };

  // メニューが隠してはいけない相手。塗っているのと同じ箱を画面の座標で渡す。
  const avoidBox = (): { top: number; bottom: number } | undefined => {
    if (!menu || !content) return undefined;
    const rel =
      menu.kind === "item" ? view?.item?.box : menu.kind === "block" ? view?.box : null;
    if (!rel) return undefined;
    const base = content.getBoundingClientRect();
    return { top: base.top + rel.top, bottom: base.top + rel.top + rel.height };
  };

  const comment = (run: () => void): MenuItem => ({
    icon: "add_comment",
    label: "コメント",
    keys: "⌘⇧I",
    run,
  });

  const items: MenuItem[] =
    menu === null
      ? []
      : menu.kind === "cell"
        ? [comment(() => onCellComment(menu.index, menu.at))]
        : menu.kind === "item"
          ? [comment(() => onItemComment(menu.index, menu.at))]
          : [
              comment(() => onComment(menu.index)),
              ...zoomItems(menu.index),
              {
                icon: "link",
                label: "リンクをコピー",
                run: () => onCopyLink(menu.index),
              },
            ];

  // つまみの置き場所。余白に入るなら本文の左の外、狭いときは本文に寄せる。
  // 箇条書きは項目の 1 行目に高さを合わせ、左は項目の左端に寄せる。本文の
  // 左端に合わせると、字下げの分だけ離れて見える。
  const room = view ? view.room + (view.item ? view.item.edge : 0) : 0;
  const anchor =
    view && !view.table
      ? {
          top: (view.item ? view.item.mid : view.y) - GRIP / 2,
          left: (view.item ? view.item.edge : 0) + (room >= ONLY ? -ONLY : 2),
        }
      : null;
  // 箇条書きの中では、指す相手は項目そのもの。
  const kind: Kind = view?.item ? "item" : "block";
  const at = view?.item ? view.item.at : (view?.index ?? 0);
  const open = (next: { kind: Kind; index: number; at: number }) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ ...next, x: e.clientX, y: e.clientY });
  };

  return (
    <>
      {layerHost &&
        createPortal(
        <div ref={layerRef} className="mg-block-layer not-prose">
          {view && anchor && (
            <div
              className="mg-gutter"
              style={{ top: anchor.top, left: anchor.left }}
            >
              <button
                type="button"
                aria-label="メニュー"
                className="mg-grip mg-grip-hold"
                onClick={open({ kind, index: view.index, at })}
                onContextMenu={open({ kind, index: view.index, at })}
              >
                <Icon name="drag_indicator" size={17} />
              </button>
            </div>
          )}

          {/* 表のつまみは表の左上の外に置く。大きさは他のブロックのつまみと
              同じ。表だけ小さいと、狙って触れるまでの手間がここだけ増える。 */}
          {view?.table && (
            <button
              type="button"
              aria-label="メニュー"
              className="mg-grip mg-grip-hold"
              style={{
                top: view.table.top,
                left: view.table.left - GRIP - HOLD_GAP,
                width: GRIP,
                height: GRIP,
              }}
              onClick={open({ kind: "block", index: view.index, at: view.index })}
              onContextMenu={open({ kind: "block", index: view.index, at: view.index })}
            >
              <Icon name="drag_indicator" size={17} />
            </button>
          )}

          {/* 何に対するメニューかを塗って示す。 */}
          {menu?.kind === "block" && view?.box && (
            <div className="mg-target" style={view.box} />
          )}
          {menu?.kind === "item" && view?.item && (
            <div className="mg-target" style={view.item.box} />
          )}
        </div>,
        layerHost,
      )}

      {menu && (
        <BlockMenu
          x={menu.x}
          y={menu.y}
          avoid={avoidBox()}
          bounds={scroller?.getBoundingClientRect()}
          items={items}
          onClose={() => setMenu(null)}
        />
      )}
      {zoomed !== null && (
        <TableModal html={zoomed} onClose={() => setZoomed(null)} />
      )}
    </>
  );
}

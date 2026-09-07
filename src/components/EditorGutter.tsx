import type { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { startCarry } from "../lib/carry";
import { blockCopy, tablePartCopy } from "../lib/dragImage";
import {
  blockActTr,
  blockMoveTr,
  type BlockAct,
} from "../lib/md/blockActs";
import {
  itemActTr,
  itemMoveTr,
  itemSpotAt,
  type ItemAct,
} from "../lib/md/itemActs";
import { schema } from "../lib/md/schema";
import { liftedKey, type LiftedSpans } from "../lib/md/lifted";
import {
  tableActTr,
  tableMoveTr,
  tableSpans,
  type TableAct,
  type TablePart,
} from "../lib/md/tableActs";
import {
  ADD,
  ADD_AWAY,
  BAR,
  BOTH,
  EDGE,
  firstLine,
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
  type TableGeometry,
} from "../lib/gutterGeom";
import { BlockMenu, type MenuItem } from "./BlockMenu";
import { Icon } from "./Icon";

// 編集面のつまみ。ブロックを掴んで動かし、表なら行と列も掴める。
//
// 読むとき側（BlockGutter）と同じ見た目・同じ並びで、相手が編集モデルの位置に
// なる。組版は動かさない。位置を測って層を重ねるだけ。
//
// 層は編集面の中には置かない。ProseMirror は自分の DOM の変化を見ていて、
// React が要素を差し込むとそれを本文の書き換えと取り違える。入れ物（host）の
// 側に置き、編集面とは兄弟にする。

type Kind = "block" | "item" | TablePart;

// 追加の帯を表から離す幅。表の枠と重ならないよう、読むとき側より広く取る
// （編集面では升目に焦点の枠が付くので、詰めると枠に重なって見える）。
const ADD_GAP = 12;

interface Spot {
  // トップレベルの何番目か。
  index: number;
  // そのブロックが始まる位置。
  pos: number;
  // 本文の左の余白。狭い画面では出すつまみを減らす。
  room: number;
  // ブロックの外枠。メニューの対象を塗るのに使う。
  box: Box;
  // 1 行目の中心。ブロックのつまみをこの高さに揃える。
  line: number;
  // 箇条書きのときだけ。Markdown ではリスト全体が 1 ブロックだが、掴む単位は
  // 項目に合わせる（リスト全体のつまみと並べると、どちらを掴んでいるのか
  // 分からなくなるので、箇条書きでは常に項目を相手にする）。
  item: {
    // その項目が始まる位置。
    pos: number;
    // 親のリストが始まる位置と、その中で何番目か。
    listPos: number;
    at: number;
    // 1 行目の中心。つまみをこの高さに揃える。
    mid: number;
    // 項目の左端（記号を含む）。つまみはここから左へ置く。
    edge: number;
    box: Box;
  } | null;
  // 表のときだけ。
  table: { rows: number; cols: number; geo: TableGeometry } | null;
}

interface Guide {
  kind: Kind;
  top: number;
  left: number;
  length: number;
}

const sameBox = (a: Box, b: Box) =>
  a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

function same(a: Spot | null, b: Spot | null): boolean {
  if (!a || !b) return a === b;
  if (a.index !== b.index || a.pos !== b.pos || a.line !== b.line) return false;
  if (a.room !== b.room || !sameBox(a.box, b.box)) return false;
  if (!a.item || !b.item) {
    if (a.item !== b.item) return false;
  } else if (
    a.item.pos !== b.item.pos ||
    a.item.mid !== b.item.mid ||
    a.item.edge !== b.item.edge ||
    !sameBox(a.item.box, b.item.box)
  ) {
    return false;
  }
  if (!a.table || !b.table) return a.table === b.table;
  const x = a.table.geo;
  const y = b.table.geo;
  return (
    a.table.rows === b.table.rows &&
    a.table.cols === b.table.cols &&
    sameBox(x.table, y.table) &&
    x.atRight === y.atRight &&
    x.bottom === y.bottom &&
    x.row?.index === y.row?.index &&
    x.row?.top === y.row?.top &&
    x.col?.index === y.col?.index &&
    x.col?.left === y.col?.left
  );
}

interface Hit {
  el: HTMLElement;
  index: number;
  pos: number;
}

// 指している高さにあるブロック。
//
// 当たり判定では拾わない。つまみは本文の外の余白に置くので、そこへ手を伸ばして
// いる間はブロックの上に居ない。ブロックは縦に並んで上端が昇順なので、その
// 高さのブロックを二分探索で挟む（上から順に測ると本文の大きさに比例して
// 遅くなる）。
function blockAtY(view: EditorView, y: number): Hit | null {
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
  // ブロックの間の余白では、下端からの距離が近い方を選ぶ。
  const next = kids[at + 1];
  if (next) {
    const here = kids[at].getBoundingClientRect();
    if (y > here.bottom) {
      const gap = next.getBoundingClientRect().top - here.bottom;
      if (gap > 0 && y - here.bottom > gap / 2) at += 1;
    }
  }
  const el = kids[at];
  if (!(el instanceof HTMLElement) || at >= view.state.doc.childCount) return null;
  let pos = 0;
  for (let i = 0; i < at; i++) pos += view.state.doc.child(i).nodeSize;
  return { el, index: at, pos };
}

// その li に対応する編集モデルの位置。項目そのものと、親のリストと並び。
function itemPosOf(
  view: EditorView,
  li: HTMLElement,
): { pos: number; listPos: number; at: number } | null {
  let inside: number;
  try {
    inside = view.posAtDOM(li, 0);
  } catch {
    return null;
  }
  if (inside < 0) return null;
  const $at = view.state.doc.resolve(
    Math.min(inside, view.state.doc.content.size),
  );
  for (let d = $at.depth; d > 0; d--) {
    if ($at.node(d).type !== schema.nodes.listItem) continue;
    const pos = $at.before(d);
    const spot = itemSpotAt(view.state.doc, pos);
    return spot ? { pos, listPos: spot.listPos, at: spot.index } : null;
  }
  return null;
}

export function EditorGutter({
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
    kind: Kind;
    spot: Spot;
    at: number;
    x: number;
    y: number;
  } | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);

  const layer = useRef<HTMLDivElement>(null);
  // 出しているものは描き直しを待たずに読みたい（測る側は React の外に居る）。
  const spotRef = useRef<Spot | null>(null);
  const menuRef = useRef(false);
  const heldRef = useRef<{ kind: Kind; spot: Spot; at: number } | null>(null);
  const toRef = useRef<number | null>(null);
  // 最後に指していた場所。中身が動いたとき、そこで測り直す。
  const atRef = useRef<{ x: number; y: number } | null>(null);
  // 最後に指していた場所で測り直す口。行や列を足した直後にも使う。
  const againRef = useRef<(() => void) | null>(null);
  // 運んでいる間の受け口。押し下げから呼ぶので、効果の外へ出しておく。
  const carryRef = useRef<{
    move: (x: number, y: number) => void;
    land: () => void;
  } | null>(null);
  // 運びを途中でやめる口と、薄くしたものを戻す口。
  const stopRef = useRef<(() => void) | null>(null);
  const unliftRef = useRef<(() => void) | null>(null);
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

    // keep を落とすと、つまみの上を指していても測り直す。表や本文の形が変わった
    // 直後は、つまみが指の下に来ているので保つ側に回ると古い置き場所のまま
    // 残り、本文に重なって見える。
    const measure = (x: number, y: number, target: Node | null, keep = true) => {
      if (heldRef.current || menuRef.current) return;
      // つまみの上に来ても保つ。消えると押せない。
      if (keep && target && layer.current?.contains(target)) return;

      const hit = blockAtY(view, y);
      if (!hit) {
        show(null);
        return;
      }
      const base = host.getBoundingClientRect();
      const box = hit.el.getBoundingClientRect();
      const room = scroller
        ? box.left - scroller.getBoundingClientRect().left
        : BOTH;

      const node = view.state.doc.child(hit.index);

      // 箇条書きは項目ごとに掴む。指している高さの li から編集モデルの位置を引く。
      const li = itemAtY(hit.el, y, "li");
      const spot = li ? itemPosOf(view, li) : null;
      const liBox = li?.getBoundingClientRect();
      const line = li && liBox ? itemLine(li, liBox) : null;

      const el = hit.el.querySelector("table");
      const geo =
        el && node.type === schema.nodes.table
          ? tableGeometry(el, Array.from(el.rows), { x, y }, base)
          : null;

      show({
        index: hit.index,
        pos: hit.pos,
        room,
        box: relative(box, base),
        item:
          li && liBox && spot && line
            ? {
                pos: spot.pos,
                listPos: spot.listPos,
                at: spot.at,
                mid: line.top - base.top + line.height / 2,
                edge: itemEdge(li) - base.left,
                box: relative(liBox, base),
              }
            : null,
        // 1 行目の字に合わせる。測れないもの（図・区切り線など）は、上端から
        // 半行下げた高さで代わりにする。
        line: (() => {
          const head = firstLine(hit.el);
          if (head && head.height > 0) return head.top - base.top + head.height / 2;
          return box.top - base.top + Math.min(lineHeight(hit.el), box.height) / 2;
        })(),
        table: geo
          ? {
              rows: node.childCount,
              cols: node.child(0)?.childCount ?? 0,
              geo: {
                ...geo,
                // 行は左の縁、列は上の縁を指したときだけ出す。表の内側どこでも
                // 出すと常に付いて回って読みにくい。1 行目は見出しなので
                // 帯を出さない（GFM の表では動かせず消せない）。
                row:
                  x <= base.left + geo.table.left + EDGE &&
                  geo.row &&
                  geo.row.index > 0
                    ? geo.row
                    : null,
                col: y <= base.top + geo.table.top + EDGE ? geo.col : null,
              },
            }
          : null,
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
      if (!held?.table) return;
      const dom = view.nodeDOM(held.pos);
      const el = dom instanceof HTMLElement ? dom.querySelector("table") : null;
      if (!el) return;
      const geo = tableBands(
        el,
        Array.from(el.rows),
        {
          row: held.table.geo.row?.index ?? null,
          col: held.table.geo.col?.index ?? null,
        },
        host.getBoundingClientRect(),
      );
      if (geo) show({ ...held, table: { ...held.table, geo } });
    };

    // 運んでいる間、指している場所から落とす先を決めて線を出す。
    const onCarry = (x: number, y: number) => {
      const held = heldRef.current;
      if (!held) return;
      const base = host.getBoundingClientRect();

      if (held.kind === "block") {
        const hit = blockAtY(view, y);
        if (!hit) return;
        const box = hit.el.getBoundingClientRect();
        const after = y > box.top + box.height / 2;
        toRef.current = after ? hit.index + 1 : hit.index;
        setGuide({
          kind: "block",
          top: (after ? box.bottom : box.top) - base.top,
          // 線はブロックの幅で引く。編集面は幅を絞って中央寄せなので、
          // 入れ物の幅で引くと左右へはみ出す。
          left: box.left - base.left,
          length: box.width,
        });
        return;
      }

      if (held.kind === "item") {
        const hit = blockAtY(view, y);
        const li = hit ? itemAtY(hit.el, y, "li") : null;
        const spot = li ? itemPosOf(view, li) : null;
        // 同じリストの中だけで動かす。
        if (!li || !spot || spot.listPos !== held.spot.item?.listPos) return;
        const box = li.getBoundingClientRect();
        const after = y > box.top + box.height / 2;
        toRef.current = after ? spot.at + 1 : spot.at;
        setGuide({
          kind: "item",
          top: (after ? box.bottom : box.top) - base.top,
          left: box.left - base.left,
          length: box.width,
        });
        return;
      }

      // 行・列は掴んだ表の中だけで動かす。
      const hit = blockAtY(view, y);
      const el = hit?.el.querySelector("table");
      if (!hit || !el || hit.pos !== held.spot.pos) return;
      const geo = tableGeometry(el, Array.from(el.rows), { x, y }, base);
      if (!geo) return;

      if (held.kind === "row") {
        const row = geo.row;
        // 見出しの上へは運ばせない。
        if (!row || row.index < 1) return;
        const after = y > base.top + row.top + row.height / 2;
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
      const after = x > base.left + col.left + col.width / 2;
      toRef.current = after ? col.index + 1 : col.index;
      setGuide({
        kind: "col",
        top: geo.table.top,
        left: col.left + (after ? col.width : 0),
        length: geo.table.height,
      });
    };

    const onLand = () => {
      const held = heldRef.current;
      const to = toRef.current;
      heldRef.current = null;
      toRef.current = null;
      setGuide(null);
      unliftRef.current?.();
      if (!held || to === null) return;
      const tr =
        held.kind === "block"
          ? blockMoveTr(view.state, held.spot.index, to)
          : held.kind === "item"
            ? held.spot.item
              ? itemMoveTr(view.state, held.spot.item.listPos, held.at, to)
              : null
            : tableMoveTr(view.state, held.spot.pos, held.kind, held.at, to);
      if (tr) view.dispatch(tr);
      view.focus();
      requestAnimationFrame(() => againRef.current?.());
    };

    carryRef.current = { move: onCarry, land: onLand };

    // 中身の高さが変わると、出したままのつまみは前の位置に取り残される。
    // 最後に指していた場所で測り直す。大きさが変わっていない知らせでは
    // 何もしない（描き直しと測り直しが互いを呼び合うのを避ける）。
    // 掴んでいる間は動かさない。
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
    return () => {
      againRef.current = null;
      carryRef.current = null;
      stopRef.current?.();
      watching.removeEventListener("mousemove", onMouseMove);
      watching.removeEventListener("mouseleave", onMouseLeave);
      watching.removeEventListener("scroll", onScroll, true);
      settle.disconnect();
    };
  }, [view, host, scroller]);

  const after = (tr: ReturnType<typeof blockActTr>) => {
    if (tr) view.dispatch(tr);
    view.focus();
    // 本文の形が変わったので置き場所を測り直す。組版が終わった次の一枚で測る。
    requestAnimationFrame(() => againRef.current?.());
  };

  const runBlock = (index: number, act: BlockAct) =>
    after(blockActTr(view.state, index, act));

  const runTable = (kind: TablePart, pos: number, at: number, act: TableAct) =>
    after(tableActTr(view.state, pos, kind, at, act));

  const runItem = (pos: number, act: ItemAct) => after(itemActTr(view.state, pos, act));

  // 出しているつまみの表。
  const tableOf = (pos: number): HTMLTableElement | null => {
    const dom = view.nodeDOM(pos);
    return dom instanceof HTMLElement ? dom.querySelector("table") : null;
  };

  // 薄くする範囲。ブロックと項目はその節点、表は掴んだ行・列の升目。
  const heldSpans = (kind: Kind, where: Spot, at: number): LiftedSpans => {
    if (kind === "row" || kind === "col") {
      return tableSpans(view.state.doc, where.pos, kind, at);
    }
    const from = kind === "item" ? (where.item?.pos ?? where.pos) : where.pos;
    const node = view.state.doc.nodeAt(from);
    return node ? [[from, from + node.nodeSize]] : [];
  };

  // 付いてくる写し。掴んだものの組みをそのまま保つ。
  const copyOf = (kind: Kind, where: Spot, at: number): HTMLElement | null => {
    if (kind === "col" || kind === "row") {
      return tablePartCopy(tableOf(where.pos), kind, at);
    }
    // 項目の at は「リストの中で何番目か」なので、実体は位置から引く。
    const dom = view.nodeDOM(
      kind === "item" ? (where.item?.pos ?? where.pos) : where.pos,
    );
    return blockCopy(dom instanceof HTMLElement ? dom : null);
  };

  // つまみを押したら運びを構える。数 px 動くまでは始まらないので、押しただけ
  // ならメニューが出る。
  //
  // HTML5 のドラッグは使わない。WebKit は離したときに写しを掴んだ場所へ戻す
  // アニメーションを出し、止められない。本文はその場で入れ替わっているので、
  // 目には「戻ってから入れ替わった」と映る。
  const hold =
    (kind: Kind, where: Spot, at: number) => (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const ghost = copyOf(kind, where, at);
      const box = e.currentTarget.getBoundingClientRect();
      stopRef.current = startCarry({
        from: { x: e.clientX, y: e.clientY },
        ghost,
        // 掴んだつまみと写しの位置関係を保つ。
        grip: { x: e.clientX - box.left + 8, y: e.clientY - box.top },
        onStart: () => {
          heldRef.current = { kind, spot: where, at };
          setMenu(null);
          lift(heldSpans(kind, where, at));
        },
        onMove: (x, y) => carryRef.current?.move(x, y),
        onDrop: () => carryRef.current?.land(),
        onCancel: () => {
          unlift();
          heldRef.current = null;
          toRef.current = null;
          setGuide(null);
        },
      });
    };

  // 掴んだものを薄くして、持ち上がったことをその場で見せる。元の位置に濃いまま
  // 残っていると動いている実感が無いので、別に囲みを描いて示す必要が出る。
  //
  // 印は装飾で渡す。クラスを DOM へ直に足すと、ProseMirror が属性の変化を
  // 本文の書き換えと見て節点を描き直し、消えてしまう。
  const mark = (spans: LiftedSpans) => {
    view.dispatch(
      view.state.tr.setMeta(liftedKey, spans).setMeta("addToHistory", false),
    );
  };
  const lift = (spans: LiftedSpans) => mark(spans);
  const unlift = () => mark([]);
  unliftRef.current = unlift;

  const open = (kind: Kind, where: Spot, at: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ kind, spot: where, at, x: e.clientX, y: e.clientY });
  };

  // 行・列のメニュー。並びは読むとき側と同じ。
  const partItems = (kind: TablePart, where: Spot, at: number): MenuItem[] => {
    const act = (a: TableAct) => () => runTable(kind, where.pos, at, a);
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

  // 箇条書きの項目のメニュー。ブロックと同じ並びに揃える。
  const itemItems = (where: Spot): MenuItem[] => {
    const at = where.item;
    if (!at) return [];
    const run = (a: ItemAct) => () => runItem(at.pos, a);
    return [
      { icon: "arrow_upward", label: "上に挿入", run: run("insertBefore") },
      { icon: "arrow_downward", label: "下に挿入", run: run("insertAfter") },
      { icon: "content_copy", label: "複製", run: run("duplicate") },
      { icon: "delete", label: "削除", run: run("delete"), danger: true },
    ];
  };

  // ブロックのメニュー。読むとき側にある「指摘する」「編集する」は入れない
  // （指摘はまだ編集面へ繋がっておらず、編集は編集面そのもの）。
  const blockItems = (where: Spot): MenuItem[] => {
    const act = (a: BlockAct) => () => runBlock(where.index, a);
    return [
      { icon: "vertical_align_top", label: "上に挿入", run: act("insertBefore") },
      { icon: "vertical_align_bottom", label: "下に挿入", run: act("insertAfter") },
      { icon: "content_copy", label: "複製", run: act("duplicate") },
      { icon: "delete", label: "削除", run: act("delete"), danger: true },
    ];
  };

  const geo = spot?.table?.geo;
  // 箇条書きでは項目を相手にする。字下げの分だけ左に余裕があるので、
  // つまみを 2 つ並べられるかはそこも足して見る。
  const grabs: Kind = spot?.item ? "item" : "block";
  const grabAt = spot?.item ? spot.item.at : (spot?.index ?? 0);
  const room = spot ? spot.room + (spot.item ? spot.item.edge : 0) : 0;
  // 使える幅。2 つ並べる余裕が無ければ掴みだけにする。
  const wide = !!spot && room >= BOTH;
  // つまみの置き場所。表は行と列の帯が交わる点、それ以外は 1 行目の左。
  // 箇条書きは項目の 1 行目に高さを合わせ、左は項目の左端に寄せる（本文の
  // 左端に合わせると、字下げの分だけ離れて見える）。
  const anchor = !spot
    ? null
    : geo
      ? {
          top: geo.table.top - ADD_AWAY - BAR / 2 - GRIP / 2,
          left: geo.table.left - ADD_AWAY - BAR / 2 - GRIP / 2,
        }
      : {
          top: (spot.item ? spot.item.mid : spot.line) - GRIP / 2,
          // 置き始めはブロック自身の左端。編集面は幅を絞って中央寄せなので、
          // 入れ物の左端から置くと余白のぶんだけ離れて出る。
          left:
            (spot.item ? spot.item.edge : spot.box.left) +
            (room >= ONLY ? -(wide ? BOTH : ONLY) : 2),
        };

  return (
    <>
      {createPortal(
        <div ref={layer} className="mg-block-layer not-prose">
          {spot && anchor && (
            <div className="mg-gutter" style={{ top: anchor.top, left: anchor.left }}>
              {/* 表は角に 1 つだけ置く。行と列の帯の間に 2 つ並べる余地が無い。 */}
              {wide && !geo && (
                <button
                  type="button"
                  title={spot.item ? "下に項目を挿入" : "下に挿入"}
                  className="mg-grip"
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={() =>
                    spot.item
                      ? runItem(spot.item.pos, "insertAfter")
                      : runBlock(spot.index, "insertAfter")
                  }
                >
                  <Icon name="add" size={17} />
                </button>
              )}
              <button
                type="button"
                title={
                  spot.item
                    ? "ドラッグで項目を移動 / クリックでメニュー"
                    : "ドラッグで移動 / クリックでメニュー"
                }
                className="mg-grip mg-grip-hold"
                onMouseDown={hold(grabs, spot, grabAt)}
                onClick={open(grabs, spot, grabAt)}
                onContextMenu={open(grabs, spot, grabAt)}
              >
                <Icon name="drag_indicator" size={17} />
              </button>
            </div>
          )}

          {geo?.row && spot && (
            <button
              type="button"
              title="ドラッグで移動 / クリックでメニュー"
              className="mg-grip mg-grip-hold mg-grip-bar"
              style={{
                top: geo.row.top,
                left: geo.table.left - BAR - ADD_AWAY,
                width: BAR,
                height: geo.row.height,
              }}
              onMouseDown={hold("row", spot, geo.row.index)}
              onClick={open("row", spot, geo.row.index)}
              onContextMenu={open("row", spot, geo.row.index)}
            >
              <Icon name="drag_indicator" size={15} />
            </button>
          )}

          {geo?.col && spot && (
            <button
              type="button"
              title="ドラッグで移動 / クリックでメニュー"
              className="mg-grip mg-grip-hold mg-grip-bar"
              style={{
                top: geo.table.top - BAR - ADD_AWAY,
                left: geo.col.left,
                width: geo.col.width,
                height: BAR,
              }}
              onMouseDown={hold("col", spot, geo.col.index)}
              onClick={open("col", spot, geo.col.index)}
              onContextMenu={open("col", spot, geo.col.index)}
            >
              <Icon name="drag_indicator" size={15} className="rotate-90" />
            </button>
          )}

          {geo && spot?.table && (
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
                  onClick={() =>
                    runTable("col", spot.pos, spot.table!.cols - 1, "insertAfter")
                  }
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
                onClick={() =>
                  runTable("row", spot.pos, spot.table!.rows - 1, "insertAfter")
                }
              >
                <Icon name="add" size={14} />
              </button>
            </>
          )}

          {/* 何に対するメニューかを塗って示す。メニューへ動かすと相手から
              離れるので、印が無いとどのブロック・行・列だったか分からなくなる。 */}
          {menu?.kind === "block" && spot && (
            <div className="mg-target" style={spot.box} />
          )}
          {menu?.kind === "item" && spot?.item && (
            <div className="mg-target" style={spot.item.box} />
          )}
          {menu?.kind === "row" && geo?.row && (
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
          {menu?.kind === "col" && geo?.col && (
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
          items={
            menu.kind === "block"
              ? blockItems(menu.spot)
              : menu.kind === "item"
                ? itemItems(menu.spot)
                : partItems(menu.kind, menu.spot, menu.at)
          }
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

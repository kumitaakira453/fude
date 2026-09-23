import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { startCarry } from "../lib/carry";
import { useLayerHost } from "../lib/layerHost";
import { blockCopy, tablePartCopy } from "../lib/dragImage";
import {
  blockActTr,
  blockMoveTr,
  type BlockAct,
} from "../lib/md/blockActs";
import type { Node as PmNode } from "prosemirror-model";
import {
  itemActTr,
  itemBoxTr,
  itemSpotAt,
  type ItemAct,
} from "../lib/md/itemActs";
import {
  depthRange,
  flatten,
  isList,
  itemDropTr,
  itemIndexOf,
  itemOutTr,
} from "../lib/md/listTree";
import { loneImage, type ImageGoes } from "../lib/md/imageDrop";
import { blockKindOf } from "../lib/md/marks";
import { schema } from "../lib/md/schema";
import { SLASH_ITEMS } from "../lib/md/slash";
import { liftedKey, type LiftedSpans } from "../lib/md/lifted";
import {
  pickedPart,
  tableActTr,
  tableMoveTr,
  tableSelectTr,
  tableSpans,
  type TableAct,
  type TablePart,
} from "../lib/md/tableActs";
import {
  ADD,
  ADD_AWAY,
  addAway,
  addBelow,
  HOLD,
  nearEdge,
  NUB,
  NUB_LONG,
  HOLD_GAP,
  holdAt,
  onLine,
  BAR,
  BOTH,
  firstLine,
  HEAD_ROW,
  tightImage,
  GRIP,
  indentStep,
  inWrap,
  itemAtY,
  itemEdge,
  itemEdgeOf,
  itemLine,
  lineHeight,
  ONLY,
  relative,
  tableBands,
  tableGeometry,
  type Box,
  type TableGeometry,
} from "../lib/gutterGeom";
import { markOf, taskMarks } from "../lib/md/taskMarks";
import { BlockMenu, type MenuItem } from "./BlockMenu";
import { TableModal, tablePlain } from "./TableModal";
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

interface Spot {
  // そのブロックが始まる位置。トグルの中身でも同じ指し方になる。
  pos: number;
  // 本文の左の余白。狭い画面では出すつまみを減らす。
  room: number;
  // ブロックの外枠。メニューの対象を塗るのに使う。
  box: Box;
  // 絵だけの塊か。塗る枠にまわりの余白を足さない。
  tight: boolean;
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
    // いちばん外の並びが始まる位置。掴む単位はこの並び全体になる。
    root: number;
    // 1 行目の中心。つまみをこの高さに揃える。
    mid: number;
    // 項目の左端（記号を含む）。つまみはここから左へ置く。
    edge: number;
    box: Box;
  } | null;
  // 溢れている表のときだけ。大きく開く印の置き場（包みの枠）。
  zoom: Box | null;
  // 表のときだけ。below は次のブロックとの空き（下のつまみの置き場所）。
  //
  // 行・列は「どこから掴めるか」を小さな棒で常に示し、指が縁に寄ったときだけ
  // つまみに育てる。nearRow / nearCol がその判定。
  table: {
    rows: number;
    cols: number;
    // 「足す」ボタンの上に手があるか。出た瞬間から押せる見た目にするために、
    // :hover に任せず自分で決める（手の下に現れた要素の hover は、その場では
    // 効かないことがある）。
    onAdd: "row" | "col" | null;
    below: number;
    nearRow: boolean;
    nearCol: boolean;
    geo: TableGeometry;
  } | null;
}

// 溢れている表の包み。大きく開く印はここの右上に置く。表そのものは
// 送った分だけ左へ出るので、置き場は包みで測る。
function overflowing(el: HTMLElement, base: DOMRect): Box | null {
  const wrap = el.querySelector<HTMLElement>(".mg-table-wrap");
  if (!wrap || wrap.scrollWidth - wrap.clientWidth <= 4) return null;
  return relative(wrap.getBoundingClientRect(), base);
}

// 大きく開く印の大きさと、包みの角からの隙間（CSS と合わせる）。
const ZOOM_SIZE = 26;
const ZOOM_EDGE = 8;

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
  if (a.pos !== b.pos || a.line !== b.line) return false;
  if (a.room !== b.room || a.tight !== b.tight) return false;
  if (!sameBox(a.box, b.box)) return false;
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
    a.table.below === b.table.below &&
    a.table.nearRow === b.table.nearRow &&
    a.table.nearCol === b.table.nearCol &&
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
  pos: number;
}

// その入れ物の中で、指している高さにある子は何番目か。
//
// 当たり判定では拾わない。つまみは本文の外の余白に置くので、そこへ手を伸ばして
// いる間はブロックの上に居ない。ブロックは縦に並んで上端が昇順なので、その
// 高さのブロックを二分探索で挟む（上から順に測ると本文の大きさに比例して
// 遅くなる）。
function childAtY(kids: HTMLCollection, y: number): number {
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
  return at;
}

// 指している高さにある、いちばん内側のブロック。
//
// トグルは中身を抱えるので、そこで止めると中のものを掴めず、運んだものの
// 落とし先にもならない。開いているトグルに当たったら中へ降りる。題は本文の
// 一部ではないので相手にしない（掴めないし、その前にも置けない）。
function blockAtY(view: EditorView, y: number): Hit | null {
  let parent = view.state.doc;
  let dom: HTMLElement = view.dom as HTMLElement;
  let base = 0;
  let hit: Hit | null = null;
  for (;;) {
    const kids = dom.children;
    if (!kids.length) return hit;
    const at = childAtY(kids, y);
    const el = kids[at];
    if (!(el instanceof HTMLElement) || at >= parent.childCount) return hit;
    const node = parent.child(at);
    if (node.type === schema.nodes.detailsSummary) return hit;
    let pos = base;
    for (let i = 0; i < at; i++) pos += parent.child(i).nodeSize;
    hit = { el, pos };
    if (node.type !== schema.nodes.details || el.classList.contains("is-closed")) return hit;
    const inner = el.querySelector(":scope > .mg-details-inner");
    if (!(inner instanceof HTMLElement)) return hit;
    parent = node;
    dom = inner;
    base = pos + 1;
  }
}

// 「足す」ボタンの帯に手が入っているか。ボタンの置き場所と同じ式で見る。
function onAddBand(
  geo: NonNullable<ReturnType<typeof tableGeometry>>,
  below: number,
  x: number,
  y: number,
): "row" | "col" | null {
  const slack = 2;
  const t = geo.table;
  const rowTop = addBelow(geo.bottom, below, ADD_AWAY);
  if (
    y >= rowTop - slack &&
    y <= rowTop + ADD + slack &&
    x >= t.left - slack &&
    x <= t.left + t.width + slack
  ) {
    return "row";
  }
  const colLeft = t.left + t.width + addAway(below, ADD_AWAY);
  if (
    geo.atRight &&
    x >= colLeft - slack &&
    x <= colLeft + ADD + slack &&
    y >= t.top - slack &&
    y <= t.top + t.height + slack
  ) {
    return "col";
  }
  return null;
}

// 直前のブロックが表で、その「足す」帯に手が入っているならそれを返す。
//
// 行を足すボタンは表の下の縁の外に置くので、そこへ手を伸ばしている間は表の
// 上に居ない。ブロックの間の余白は近い方が選ばれるため、そのままでは次の
// ブロックが相手になって、ボタンが出る前に消える。
function tableBand(view: EditorView, hit: Hit, y: number): Hit | null {
  const $at = view.state.doc.resolve(hit.pos);
  const before = $at.nodeBefore;
  if (!before || before.type !== schema.nodes.table) return null;
  const pos = hit.pos - before.nodeSize;
  const el = view.nodeDOM(pos);
  if (!(el instanceof HTMLElement)) return null;
  const box = el.getBoundingClientRect();
  if (y < box.bottom || y > box.bottom + ADD_AWAY + ADD) return null;
  return { el, pos };
}

// その li に対応する編集モデルの位置。項目そのものと、親のリストと並び。
//
// `root` はいちばん外の並び。入れ子の項目でも、掴む単位はこの並び全体になる
// （並べ替えも外へ出すのも、木ごと組み直すため）。
function itemPosOf(
  view: EditorView,
  li: HTMLElement,
): { pos: number; listPos: number; at: number; root: number } | null {
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
  let root = -1;
  let found: number | null = null;
  for (let d = $at.depth; d > 0; d--) {
    const node = $at.node(d);
    if (isList(node)) root = $at.before(d);
    if (found === null && node.type === schema.nodes.listItem) found = $at.before(d);
  }
  if (found === null || root < 0) return null;
  const spot = itemSpotAt(view.state.doc, found);
  return spot ? { pos: found, listPos: spot.listPos, at: spot.index, root } : null;
}

// 【一時】つまみの置き場所を追う。原因が分かったら消す。
export function EditorGutter({
  view,
  host,
  scroller,
  onComment,
  onCopyLink,
  images,
}: {
  view: EditorView;
  host: HTMLElement;
  scroller: HTMLElement | null;
  // 指摘する。ブロック丸ごとなら pos だけ、箇条書きの項目のように中の一部を
  // 相手にするなら範囲も渡す。渡されたときだけメニューに出す。
  onComment?: (pos: number, span?: { from: number; to: number }) => void;
  // その塗を指すリンクを写す。行き先は位置から出す。
  onCopyLink?: (pos: number) => void;
  // 画像の取り込み口。画像だけの塊にメニューを出すときに使う。
  images?: ImageGoes;
}) {
  // 層の置き場所。React が描いている入れ物へ直に差すと、ファイルを
  // 切り替えたときに片付けの順で落ちる（useLayerHost の説明）。
  const layerHost = useLayerHost(host);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [menu, setMenu] = useState<{
    kind: Kind;
    spot: Spot;
    at: number;
    x: number;
    y: number;
  } | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  // 大きく開いて見ている表（描き上がった姿を写したもの）。
  const [zoomed, setZoomed] = useState<string | null>(null);

  const layer = useRef<HTMLDivElement>(null);
  // 出しているものは描き直しを待たずに読みたい（測る側は React の外に居る）。
  const spotRef = useRef<Spot | null>(null);
  const menuRef = useRef(false);
  const heldRef = useRef<{ kind: Kind; spot: Spot; at: number } | null>(null);
  const toRef = useRef<number | null>(null);
  // 項目の落とし先。隙間と、そこで入る深さ。
  const dropRef = useRef<{ slot: number; depth: number } | null>(null);
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

      const found = blockAtY(view, y);
      if (!found) {
        show(null);
        return;
      }
      const hit = tableBand(view, found, y) ?? found;
      const base = host.getBoundingClientRect();
      const box = hit.el.getBoundingClientRect();

      const node = view.state.doc.nodeAt(hit.pos);
      if (!node) {
        show(null);
        return;
      }

      // 絵の塊は絵そのものを相手にする。入れ物は本文の幅いっぱいに広がるので、
      // そのまま塗ると絵より大きい枠が出る。
      const tight =
        node.type === schema.nodes.imageBlock ? tightImage(hit.el) : null;
      const outline = tight ?? box;
      const room = scroller
        ? outline.left - scroller.getBoundingClientRect().left
        : BOTH;

      // 箇条書きは項目ごとに掴む。指している高さの li から編集モデルの位置を引く。
      // 囲みの中は囲みごと掴ませる（gutterGeom の inWrap）。
      const near = itemAtY(hit.el, y, "li");
      const li = near && inWrap(near, hit.el) ? null : near;
      const spot = li ? itemPosOf(view, li) : null;
      const liBox = li?.getBoundingClientRect();
      const line = li && liBox ? itemLine(li, liBox) : null;

      // 表の下につまみを置ける高さ。次のブロックの上端までの空きで決める。
      // 次が無ければ下にあるのは本文の末尾の余白だけなので、空きは限りない。
      const $hit = view.state.doc.resolve(hit.pos);
      const after =
        $hit.index() + 1 < $hit.parent.childCount
          ? view.nodeDOM(hit.pos + node.nodeSize)
          : null;
      const below =
        after instanceof HTMLElement
          ? Math.max(0, after.getBoundingClientRect().top - box.bottom)
          : Infinity;

      const el = hit.el.querySelector("table");
      const geo =
        el && node.type === schema.nodes.table
          ? tableGeometry(el, Array.from(el.rows), { x, y }, base)
          : null;

      show({
        pos: hit.pos,
        room,
        box: relative(outline, base),
        tight: !!tight,
        item:
          li && liBox && spot && line
            ? {
                pos: spot.pos,
                listPos: spot.listPos,
                at: spot.at,
                root: spot.root,
                mid: line.top - base.top + line.height / 2,
                edge: itemEdge(li) - base.left,
                box: relative(liBox, base),
              }
            : null,
        // 1 行目の字に合わせる。測れないもの（図・区切り線など）は、上端から
        // 半行下げた高さで代わりにする。
        //
        // どちらも上端から 1 行ぶんまでに抑える。表や絵のような背の高い塊で
        // 下がると、つまみが本文の横で真ん中に浮き、何を掴むのか読めない。
        line: (() => {
          const top = outline.top - base.top;
          const lift = Math.min(lineHeight(hit.el), outline.height, HEAD_ROW) / 2;
          const head = firstLine(hit.el);
          if (head && head.height > 0) {
            return Math.min(head.top - base.top + head.height / 2, top + lift);
          }
          return top + lift;
        })(),
        zoom: overflowing(hit.el, base),
        table: geo
          ? {
              rows: node.childCount,
              cols: node.child(0)?.childCount ?? 0,
              onAdd: onAddBand(geo, below, x - base.left, y - base.top),
              below,
              // 縁に寄ったらつまみに育てる。寄っていないあいだは棒だけ。
              nearRow: nearEdge(x, base.left + geo.table.left),
              nearCol: nearEdge(y, base.top + geo.table.top),
              geo: {
                ...geo,
                // 1 行目は見出しなので相手にしない（GFM の表では動かせず
                // 消せない）。
                row: geo.row && geo.row.index > 0 ? geo.row : null,
                col: geo.col,
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
        const node = hit ? view.state.doc.nodeAt(hit.pos) : null;
        if (!hit || !node) return;
        const box = hit.el.getBoundingClientRect();
        const after = y > box.top + box.height / 2;
        toRef.current = after ? hit.pos + node.nodeSize : hit.pos;
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
        const held_item = held.spot.item;
        const hit = blockAtY(view, y);
        if (!held_item || !hit) return;
        const li = itemAtY(hit.el, y, "li");
        const over = li ? itemPosOf(view, li) : null;

        // 掴んだ並びの外。塊の境目を落とし先にして、項目を並びから出す。
        // トグルの中の塊も境目になるので、そのまま中へ入れられる。
        if (!li || !over || over.root !== held_item.root) {
          const node = view.state.doc.nodeAt(hit.pos);
          if (!node) return;
          const out = hit.el.getBoundingClientRect();
          const below = y > out.top + out.height / 2;
          toRef.current = below ? hit.pos + node.nodeSize : hit.pos;
          dropRef.current = null;
          setGuide({
            kind: "item",
            top: (below ? out.bottom : out.top) - base.top,
            left: out.left - base.left,
            length: out.width,
          });
          return;
        }

        const listPos = held_item.root;
        const list = view.state.doc.nodeAt(listPos);
        if (!list) return;
        const from = itemIndexOf(list, listPos, held_item.pos);
        const under = itemIndexOf(list, listPos, over.pos);
        if (from === null || under === null) return;

        const box = li.getBoundingClientRect();
        const below = y > box.top + box.height / 2;
        const slot = below ? under + 1 : under;
        // 指の横位置で深さを決める。置ける幅は上下の項目が決める。
        const { min, max } = depthRange(flatten(list), from, slot);
        const step = indentStep(hit.el);
        const edge = itemEdgeOf(hit.el);
        const depth = Math.max(min, Math.min(max, Math.round((x - edge) / step)));
        dropRef.current = { slot, depth };
        toRef.current = null;

        const right = hit.el.getBoundingClientRect().right;
        const left = edge + depth * step;
        setGuide({
          kind: "item",
          top: (below ? box.bottom : box.top) - base.top,
          left: left - base.left,
          length: Math.max(GRIP, right - left),
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
      const drop = dropRef.current;
      heldRef.current = null;
      toRef.current = null;
      dropRef.current = null;
      setGuide(null);
      unliftRef.current?.();
      if (!held) return;
      if (held.kind === "item" && !drop && to === null) return;
      const listPos = held.spot.item?.root ?? null;
      const list = listPos === null ? null : view.state.doc.nodeAt(listPos);
      const from =
        held.spot.item && list && listPos !== null
          ? itemIndexOf(list, listPos, held.spot.item.pos)
          : null;
      const tr =
        held.kind === "item"
          ? from === null || listPos === null
            ? null
            : drop
              ? itemDropTr(view.state, listPos, from, drop.slot, drop.depth)
              : to === null
                ? null
                : itemOutTr(view.state, listPos, from, to)
          : to === null
            ? null
            : held.kind === "block"
              ? blockMoveTr(view.state, held.spot.pos, to)
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

    // 字下げ（Tab / ⇧Tab）のように、大きさは変わらないのに位置だけが動くこと
    // がある。項目が入れ子の並びへ移るだけなので、大きさの見張りでは気付けず、
    // つまみが元の場所に取り残される。節点の入れ替わりも合図にする。
    // 1 枚に 1 回へまとめる（打鍵のたびに測ると本文の大きさに比例して効く）。
    let soon = 0;
    const shifted = new MutationObserver(() => {
      if (soon || heldRef.current) return;
      soon = requestAnimationFrame(() => {
        soon = 0;
        if (!heldRef.current) again();
      });
    });
    shifted.observe(view.dom, { childList: true, subtree: true });

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
      shifted.disconnect();
      cancelAnimationFrame(soon);
    };
  }, [view, host, scroller]);

  // 操作しても、見ていた場所は動かさない。
  //
  // 表は節点ごと差し替えるので、中の横スクロールは DOM が作り直されて 0 へ
  // 戻る（列を足すと左端まで巻き戻るのがこれ）。カーソルの置き場所も端の升目に
  // なることがあり、焦点を戻した番に WebKit がそこを見せようとして縦にも飛ぶ
  // （行を足す・一番下の行や一番右の列を消すと表の頭まで戻るのがこれ）。
  // どちらも操作の副作用で、見ていた場所を変える理由が無い。
  //
  // 表の入れ物は差し替わるので、要素ではなく並び順で覚えて戻す。
  const holdView = (): (() => void) => {
    const wraps = () => [...view.dom.querySelectorAll<HTMLElement>(".mg-table-wrap")];
    const top = scroller?.scrollTop ?? null;
    const lefts = wraps().map((el) => el.scrollLeft);
    return () => {
      if (scroller && top !== null) scroller.scrollTop = top;
      wraps().forEach((el, i) => {
        const left = lefts[i];
        if (left !== undefined) el.scrollLeft = left;
      });
    };
  };

  // 足した行・列を見えるところまで寄せる。寄せ幅は最小限にする（表の頭へ
  // 巻き戻さない）。
  const reveal = (part: { pos: number; kind: TablePart; at: number }) => {
    const dom = view.nodeDOM(part.pos);
    const table = dom instanceof HTMLElement ? dom.querySelector("table") : null;
    const rows = [...(table?.querySelectorAll(":scope > tbody > tr") ?? [])];
    const row = part.kind === "row" ? rows[Math.min(part.at, rows.length - 1)] : rows[0];
    const cells = [...(row?.children ?? [])];
    const cell =
      part.kind === "row" ? cells[0] : cells[Math.min(part.at, cells.length - 1)];
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const after = (
    tr: ReturnType<typeof blockActTr>,
    grew: { pos: number; kind: TablePart; at: number } | null = null,
  ) => {
    const hold = holdView();
    if (tr) view.dispatch(tr);
    view.focus();
    hold();
    // 本文の形が変わったので置き場所を測り直す。組版が終わった次の一枚で測る。
    // 見せようとする動きは配り終えた後に来ることがあるので、そこでも戻す。
    requestAnimationFrame(() => {
      hold();
      if (grew) reveal(grew);
      againRef.current?.();
    });
  };

  const runBlock = (pos: number, act: BlockAct) =>
    after(blockActTr(view.state, pos, act));

  // 行・列を足したときは、足したものが見えるところまで寄せる。端に足すと
  // 画面の外に入るので、そのままでは何が起きたのか分からない。
  // 消したときは寄せない（見ていた場所を動かさない）。
  const runTable = (kind: TablePart, pos: number, at: number, act: TableAct) => {
    const grows = act === "insertBefore" || act === "insertAfter" || act === "duplicate";
    const to = act === "insertBefore" ? at : at + 1;
    after(tableActTr(view.state, pos, kind, at, act), grows ? { pos, kind, at: to } : null);
  };

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
          dropRef.current = null;
          setGuide(null);
        },
      });
    };

  // 掴んだものを薄くして、持ち上がったことをその場で見せる。元の位置に濃いまま
  // 残っていると動いている実感が無いので、別に囲みを描いて示す必要が出る。
  //
  // 印は装飾で渡す。クラスを DOM へ直に足すと、ProseMirror が属性の変化を
  // 本文の書き換えと見て節点を描き直し、消えてしまう。
  //
  // 片付けた編集面へは流さない。この部品が消える番に運びの後片付け
  // （stopRef → onCancel → unlift）が走るが、編集面を持っているのは親なので、
  // そのときには既に片付いている。
  const mark = (spans: LiftedSpans) => {
    if (view.isDestroyed) return;
    view.dispatch(
      view.state.tr.setMeta(liftedKey, spans).setMeta("addToHistory", false),
    );
  };
  const lift = (spans: LiftedSpans) => mark(spans);
  const unlift = () => mark([]);
  unliftRef.current = unlift;

  const open = (kind: Kind, where: Spot, at: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    // 行・列は押した時点で選ぶ。何を相手にしているかが囲みで出るので、
    // メニューが離れた場所に出ても分かる。
    if (kind === "row" || kind === "col") {
      const tr = tableSelectTr(view.state, where.pos, kind, at);
      if (tr) view.dispatch(tr);
    }
    setMenu({ kind, spot: where, at, x: e.clientX, y: e.clientY });
  };

  // メニューが隠してはいけない相手。塗っているのと同じ箱を画面の座標で渡す。
  const avoidBox = (): { top: number; bottom: number } | undefined => {
    if (!menu) return undefined;
    const rel =
      menu.kind === "item" ? spot?.item?.box : menu.kind === "block" ? spot?.box : null;
    if (!rel) return undefined;
    const base = host.getBoundingClientRect();
    return { top: base.top + rel.top, bottom: base.top + rel.top + rel.height };
  };

  // 行・列のメニュー。並びは読むとき側と同じ。
  const partItems = (kind: TablePart, where: Spot, at: number): MenuItem[] => {
    const act = (a: TableAct) => () => runTable(kind, where.pos, at, a);
    const row = kind === "row";
    // 行への指摘は、その行の升目をまとめた範囲を相手にする。列は原文の上で
    // 続きになっていないので（升目が行ごとに離れる）、列の名前＝見出しの升目を
    // 相手にする。中身の無いところは範囲を持てないので、表の塊を相手にする。
    const cells = tableSpans(view.state.doc, where.pos, kind, at);
    const cover = cells.length
      ? { from: cells[0][0] + 1, to: (row ? cells[cells.length - 1][1] : cells[0][1]) - 1 }
      : null;
    const comment: MenuItem[] = onComment
      ? [
          {
            icon: "chat_bubble",
            label: "コメント",
            run: () =>
              onComment(where.pos, cover && cover.to > cover.from ? cover : undefined),
          },
        ]
      : [];
    return [
      ...comment,
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
    // 項目への指摘。相手はリストの塊で、範囲はその項目の中身。
    const node = view.state.doc.nodeAt(at.pos);
    const comment: MenuItem[] =
      onComment && node
        ? [
            {
              icon: "chat_bubble",
              label: "コメント",
              run: () =>
                onComment(where.pos, {
                  from: at.pos + 1,
                  to: at.pos + node.nodeSize - 1,
                }),
            },
          ]
        : [];
    return [
      ...comment,
      typeMenu(at.pos),
      markMenu(at.pos, node),
      { icon: "arrow_upward", label: "上に挿入", run: run("insertBefore") },
      { icon: "arrow_downward", label: "下に挿入", run: run("insertAfter") },
      { icon: "content_copy", label: "複製", run: run("duplicate") },
      { icon: "delete", label: "削除", run: run("delete"), danger: true },
    ];
  };

  // タスクの印。押して入れ替わるのは未完了と完了だけなので、それ以外の印は
  // ここから選ぶ。印の無い項目に選べば、そのままタスクになる。
  const markMenu = (pos: number, node: PmNode | null | undefined): MenuItem => {
    const now = (node?.attrs.box as string | null) ?? null;
    return {
      icon: "checklist",
      label: "タスクの印",
      items: taskMarks().map((ch) => ({
        icon: "check_box_outline_blank",
        mark: ch,
        label: markOf(ch)?.name ?? ch,
        on: now === ch,
        run: () => after(itemBoxTr(view.state, pos, ch)),
      })),
    };
  };

  // ブロックの種別を変える一覧。相手はつまみを出しているブロックなので、
  // 先にそこへカーソルを移してから変換の手を走らせる。
  //
  // 置けない種別は押せないようにする（表のセルの中では見出しにも箇条書きにも
  // できない）。効くかどうかは手そのものに聞く（dispatch を渡さずに呼ぶと、
  // 効くかだけを返す）。
  const typeItems = (pos: number): MenuItem[] => {
    const doc = view.state.doc;
    const aim = view.state.tr.setSelection(
      TextSelection.near(doc.resolve(Math.min(pos + 1, doc.content.size))),
    );
    const probe = view.state.apply(aim);
    const now = blockKindOf(probe)?.id;
    return SLASH_ITEMS.filter((one) => !one.inserts).map((one) => ({
      icon: one.icon,
      label: one.label,
      keys: one.hint || undefined,
      on: one.id === now,
      disabled: !one.run(probe, undefined),
      run: () => {
        view.dispatch(aim);
        one.run(view.state, view.dispatch, view);
        view.focus();
      },
    }));
  };

  const typeMenu = (pos: number): MenuItem => {
    const types = typeItems(pos);
    return {
      icon: "sync_alt",
      label: "ブロックタイプの変換",
      items: types,
      disabled: types.every((one) => one.disabled),
    };
  };

  // 画像だけの塊に足す項目。使われなくなった元のファイルは消さない。
  // 他の文書から参照されているかは、この操作の中では分からない。
  const imageItems = (pos: number): MenuItem[] => {
    const held = images ? loneImage(view.state.doc, pos) : null;
    if (!images || !held) return [];
    const src = held.node.attrs.src as string;
    return [
      {
        icon: "subtitles",
        label: "キャプション",
        run: () => {
          // 欄は本文の側（NodeView）が持つ。空でも出して、そこへ手を渡す。
          const dom = view.nodeDOM(held.at);
          if (!(dom instanceof HTMLElement)) return;
          dom.classList.add("has-cap");
          dom.querySelector<HTMLInputElement>(".mg-cap")?.focus();
        },
      },
      { icon: "image", label: "画像をコピー", run: () => images.copy(src) },
      {
        icon: "swap_horiz",
        label: "置換",
        run: () => {
          void images.pick().then(async (chosen) => {
            if (!chosen) return;
            const next = await images.take(chosen);
            // 押してから決まるまでに本文が動いていることがある。取り直す。
            const now = loneImage(view.state.doc, pos);
            if (!next || !now) return;
            view.dispatch(
              view.state.tr.setNodeMarkup(now.at, null, { ...now.node.attrs, src: next }),
            );
          });
        },
      },
    ];
  };

  // ブロックのメニュー。読むとき側にある「編集する」は入れない
  // （編集は編集面そのもの）。
  // 表なら「大きく開く」。溢れていなくても出す（一覧から消えると、どこに
  // あったのか探し直すことになる）。
  const zoomItems = (pos: number): MenuItem[] => {
    const table = tableOf(pos);
    if (!table) return [];
    return [
      {
        icon: "zoom_out_map",
        label: "大きく開く",
        run: () => setZoomed(tablePlain(table)),
      },
    ];
  };

  const blockItems = (where: Spot): MenuItem[] => {
    const act = (a: BlockAct) => () => runBlock(where.pos, a);
    const comment: MenuItem[] = onComment
      ? [
          {
            icon: "chat_bubble",
            label: "コメント",
            run: () => onComment(where.pos),
          },
        ]
      : [];
    const link: MenuItem[] = onCopyLink
      ? [
          {
            icon: "link",
            label: "リンクをコピー",
            run: () => onCopyLink(where.pos),
          },
        ]
      : [];
    return [
      ...comment,
      ...link,
      ...imageItems(where.pos),
      ...zoomItems(where.pos),
      typeMenu(where.pos),
      { icon: "vertical_align_top", label: "上に挿入", run: act("insertBefore") },
      { icon: "vertical_align_bottom", label: "下に挿入", run: act("insertAfter") },
      { icon: "content_copy", label: "複製", run: act("duplicate") },
      { icon: "delete", label: "削除", run: act("delete"), danger: true },
    ];
  };

  // いま選ばれている行 / 列。押し込んで見せる相手。
  const picked = pickedPart(view.state);
  const geo = spot?.table?.geo;
  // 箇条書きでは項目を相手にする。字下げの分だけ左に余裕があるので、
  // つまみを 2 つ並べられるかはそこも足して見る。
  const grabs: Kind = spot?.item ? "item" : "block";
  const grabAt = spot?.item ? spot.item.at : 0;
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
          top: geo.table.top,
          left: geo.table.left - (wide ? BOTH : GRIP) - HOLD_GAP,
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
      {layerHost &&
        createPortal(
        <div ref={layer} className="mg-block-layer not-prose">
          {spot?.zoom && (
            <button
              type="button"
              title="大きく開く"
              className="mg-table-zoom is-free"
              style={{
                top: spot.zoom.top + ZOOM_EDGE,
                left: spot.zoom.left + spot.zoom.width - ZOOM_EDGE - ZOOM_SIZE,
              }}
              onClick={() => {
                const table = tableOf(spot.pos);
                if (table) setZoomed(tablePlain(table));
              }}
            >
              <Icon name="zoom_out_map" size={15} />
            </button>
          )}
          {spot && anchor && (
            <div className="mg-gutter" style={{ top: anchor.top, left: anchor.left }}>
              {wide && (
                <button
                  type="button"
                  title={spot.item ? "下に項目を挿入" : "下に挿入"}
                  className="mg-grip"
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={() =>
                    spot.item
                      ? runItem(spot.item.pos, "insertAfter")
                      : runBlock(spot.pos, "insertAfter")
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
            // 縁に寄っていないあいだは棒だけ。押せるので、そこから直に掴める。
            <button
              type="button"
              title="ドラッグで移動 / クリックで行を選ぶ"
              className={`mg-grip mg-grip-hold mg-grip-bar${
                spot.table?.nearRow ? "" : " mg-nub"
              }${picked?.kind === "row" && picked.at === geo.row.index ? " is-on" : ""}`}
              style={
                spot.table?.nearRow
                  ? {
                      top: holdAt(geo.row.top, geo.row.height),
                      left: onLine(geo.table.left, BAR),
                      width: BAR,
                      height: HOLD,
                    }
                  : {
                      top: holdAt(geo.row.top, geo.row.height),
                      left: onLine(geo.table.left, NUB),
                      width: NUB,
                      height: NUB_LONG,
                    }
              }
              onMouseDown={hold("row", spot, geo.row.index)}
              onClick={open("row", spot, geo.row.index)}
              onContextMenu={open("row", spot, geo.row.index)}
            >
              {spot.table?.nearRow && <Icon name="drag_indicator" size={15} />}
            </button>
          )}

          {geo?.col && spot && (
            <button
              type="button"
              title="ドラッグで移動 / クリックで列を選ぶ"
              className={`mg-grip mg-grip-hold mg-grip-bar${
                spot.table?.nearCol ? "" : " mg-nub"
              }${picked?.kind === "col" && picked.at === geo.col.index ? " is-on" : ""}`}
              style={
                spot.table?.nearCol
                  ? {
                      top: onLine(geo.table.top, BAR),
                      left: holdAt(geo.col.left, geo.col.width),
                      width: HOLD,
                      height: BAR,
                    }
                  : {
                      top: onLine(geo.table.top, NUB),
                      left: holdAt(geo.col.left, geo.col.width),
                      width: NUB_LONG,
                      height: NUB,
                    }
              }
              onMouseDown={hold("col", spot, geo.col.index)}
              onClick={open("col", spot, geo.col.index)}
              onContextMenu={open("col", spot, geo.col.index)}
            >
              {spot.table?.nearCol && (
                <Icon name="drag_indicator" size={15} className="rotate-90" />
              )}
            </button>
          )}

          {geo && spot?.table && (
            <>
              {geo.atRight && (
                <button
                  type="button"
                  title="列を追加"
                  className={`mg-grip mg-grip-bar mg-grip-add${
                    spot.table.onAdd === "col" ? " is-on" : ""
                  }`}
                  style={{
                    top: geo.table.top,
                    left: geo.table.left + geo.table.width + addAway(spot.table.below, ADD_AWAY),
                    width: ADD,
                    height: geo.table.height,
                  }}
                  onClick={() =>
                    runTable("col", spot.pos, spot.table!.cols - 1, "insertAfter")
                  }
                >
                  <Icon name="add" size={12} />
                </button>
              )}
              <button
                type="button"
                title="行を追加"
                className={`mg-grip mg-grip-bar mg-grip-add${
                  spot.table.onAdd === "row" ? " is-on" : ""
                }`}
                style={{
                  top: addBelow(geo.bottom, spot.table.below, ADD_AWAY),
                  left: geo.table.left,
                  width: geo.table.width,
                  height: ADD,
                }}
                onClick={() =>
                  runTable("row", spot.pos, spot.table!.rows - 1, "insertAfter")
                }
              >
                <Icon name="add" size={12} />
              </button>
            </>
          )}

          {/* 何に対するメニューかを塗って示す。メニューへ動かすと相手から
              離れるので、印が無いとどのブロック・行・列だったか分からなくなる。 */}
          {menu?.kind === "block" && spot && (
            <div
              className={`mg-target${spot.tight ? " is-tight" : ""}`}
              style={spot.box}
            />
          )}
          {menu?.kind === "item" && spot?.item && (
            <div className="mg-target" style={spot.item.box} />
          )}
          {/* 行・列は押した時点で選ぶので、メニューの対象は塗らない
              （選んだ囲みが同じ場所に同じ形で出て、二重になる）。 */}

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
        layerHost,
      )}

      {menu && (
        <BlockMenu
          x={menu.x}
          y={menu.y}
          avoid={avoidBox()}
          bounds={scroller?.getBoundingClientRect()}
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
      {zoomed !== null && (
        <TableModal html={zoomed} onClose={() => setZoomed(null)} />
      )}
    </>
  );
}

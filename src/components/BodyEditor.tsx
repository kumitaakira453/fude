import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { Fragment, type Node as PmNode } from "prosemirror-model";
import { CellSelection } from "prosemirror-tables";
import { EditorView } from "prosemirror-view";
// ProseMirror が要る土台の指定。改行の前後に挟む見えない img を本文の img 指定から
// 守るもの（無いと typography の余白が付いて、改行のたびに隙間が空く）や、
// 選択の見せ方が入っている。
import "prosemirror-view/style/prosemirror.css";
import { useEffect, useRef, useState } from "react";
import { throttled } from "../lib/later";
import { calloutIcoAt, setCalloutIcon } from "../lib/md/calloutIcon";
import { fromMarkdown, type Loaded } from "../lib/md/fromMarkdown";
import { schema } from "../lib/md/schema";
import { parseAway } from "../lib/md/parseAway";
import { GROW } from "../lib/md/grow";
import { nodeViews, type EditorDeps } from "../lib/md/nodeViews";
import { openUrl } from "@tauri-apps/plugin-opener";
import { reload } from "../lib/md/reload";
import { anchorTo, posOfAnchor } from "../lib/md/reviewAnchors";
import { land, type Section } from "../lib/anchors";

// 編集面の中で、その節へ寄せる。編集面の見出しには id が無いので、字から
// 位置を引く。見つからなければ呼び出し側へ返す（外の画面が持っているかも
// しれない）。
function toAnchor(view: EditorView, id: string, miss: () => void): void {
  const at = posOfAnchor(view.state.doc, id);
  const dom = at === null ? null : view.nodeDOM(at);
  if (dom instanceof HTMLElement) land(dom);
  else miss();
}
import {
  closeEmoji,
  emojiKey,
  emojiSpanAt,
  swapEmoji,
  takeEmoji,
} from "../lib/md/emoji";
import { markEditing } from "../lib/md/editing";
import { applyMath, closeMath, liveMath, mathKey } from "../lib/md/math";
import type { ImageGoes } from "../lib/md/imageDrop";
import { editorPlugins } from "../lib/md/plugins";
import { domSpan, type Span } from "../lib/md/domSpan";
import { seenAt } from "../lib/md/seenAt";
import { selectionRects, type Rect } from "../lib/md/selectionRects";
import { toMarkdown } from "../lib/md/toMarkdown";
import { linkSpanAt, relink } from "../lib/md/marks";
import { AskBox } from "./AskBox";
import { LinkCard } from "./LinkCard";
import { EmojiBoard } from "./EmojiBoard";
import { EditorGutter } from "./EditorGutter";
import { MermaidModal } from "./MermaidModal";

// 組版されたまま書く全文編集。
//
// 中身は編集モデル（ProseMirror）で、Markdown は保存のときに書き戻す。
// 触っていないところは原文のまま出るので、1 文字打っても動くのはその 1 文字だけ。
//
// 扱うのは本文だけ。フロントマターは前に付け直して返す。
//
// 見ていた場所は、読むときと同じ「本文の先頭からの文字数」でやり取りする。
// 行き来しても同じところに戻るように、開いたら合わせ、動かしたら控える。

// 打鍵が途切れてから組み直すまでの待ちと、打ち続けているときの上限。
//
// 本文全体の組み直しは大きいファイルで 20ms を超える（929 ブロックで実測）。
// 打鍵ごとに走らせると引っかかるので、手を止めてから 1 回だけ流す。
// 止めなくても上限ごとに流すので、長く打ち続けても書きかけは残る。
const WAIT = 500;
const CAP = 3000;

interface Block {
  pos: number;
  start: number;
  end: number;
}

// トップレベルのブロックを、doc の位置と原文の範囲の対で並べる。
function blocksOf(loaded: Loaded): Block[] {
  const out: Block[] = [];
  loaded.doc.forEach((node, pos) => {
    const range = loaded.ranges.get(node.attrs.id as string);
    if (range) out.push({ pos, start: range[0], end: range[1] });
  });
  return out;
}

// 押されたところにある囲みのアイコン。無ければ null。
function icoOf(event: Event): Element | null {
  return event.target instanceof Element
    ? event.target.closest(".mg-callout-ico")
    : null;
}

// 縦スクロールを持つ最初の親。本文の入れ物は呼び出し側が持っている。
function scrollerOf(from: HTMLElement | null): HTMLElement | null {
  for (let el = from?.parentElement ?? null; el; el = el.parentElement) {
    const how = getComputedStyle(el).overflowY;
    if (how === "auto" || how === "scroll") return el;
  }
  return null;
}



// 組み立てた編集面。中の DOM は ProseMirror が持つので、重ねるものは
// host（その外側の入れ物）へ入れる。
export interface Editing {
  view: EditorView;
  host: HTMLElement;
  loaded: () => Loaded;
}

// カーソルを自分で描く。
//
// 標準のカーソルは行の高さで描かれるので、明朝のように上下へ余裕のある書体と
// 広い行間が重なると字よりずっと大きくなる（ゴシックや行間を詰めたときは
// 起きない）。高さを決める指定は CSS に無い（caret-color は色だけ）。
// 字の箱に合わせた棒を自分で重ね、標準は caret-color で消す。
// CodeMirror の drawSelection も同じ作りで、これが一般的な対応。
//
// 変換中も自分で描く。ただし変換中は編集モデルがまだ更新されていないので、
// 位置は DOM 側の選択から測る（IME のカーソルはそこに出ている）。測れなければ
// 標準へ戻す。

// 棒をどこに置くか。"native" は棒が要るのに測れないので標準のカーソルへ
// 戻す合図、"keep" は今のままにする合図、null は棒が要らない（範囲を選んで
// いる・焦点が無い）。
type Spot = { left: number; top: number; height: number } | "native" | "keep" | null;

function caretBar(view: EditorView, host: HTMLElement) {
  const bar = document.createElement("div");
  bar.className = "mg-caret is-idle";
  bar.style.display = "none";
  host.appendChild(bar);

  // 直前に描いた場所。同じなら書き直さない。style を書くだけでレイアウトが
  // 無効になるので、動いていないときに書くのは丸損。
  let was = "";
  // 棒を出しているか。
  let shown = false;
  // 標準のカーソルへ戻しているか。
  //
  // 戻す指定（caret-color）は継ぐ指定なので、書き換えると本文まるごとの
  // スタイル再計算が走る。2000 ブロックで実測 62〜127ms、300 ブロックで
  // 8〜15ms と本文の大きさに比例する。常時は CSS 側の「透明」に任せ、ここは
  // 戻すときだけ触る（測れない場所は稀）。
  let native = false;

  const standard = (on: boolean) => {
    if (native === on) return;
    native = on;
    view.dom.style.caretColor = on ? "var(--mg-accent)" : "";
  };

  const hide = () => {
    if (!shown) return;
    shown = false;
    was = "";
    bar.style.display = "none";
  };

  // 変換中の位置。DOM 側の選択はそのまま IME のカーソルを指している。
  const fromDom = (): { left: number; top: number; bottom: number } | null => {
    const sel = view.dom.ownerDocument.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!range.collapsed || !view.dom.contains(range.startContainer)) return null;
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!rect || rect.bottom - rect.top <= 0) return null;
    return { left: rect.left, top: rect.top, bottom: rect.bottom };
  };

  const measure = (): Spot => {
    const { selection } = view.state;
    if (!selection.empty || !view.hasFocus()) return null;
    // 隠れているところ（図だけを出している塊の中など）は測れない。
    let at: { left: number; top: number; bottom: number } | null = null;
    try {
      at = view.composing ? fromDom() : view.coordsAtPos(selection.head);
    } catch {
      at = null;
    }
    // 変換中に測れないことがある。ここで標準のカーソルへ戻すと、継ぐ指定
    // （caret-color）の書き換えで本文まるごとのスタイル再計算が走る（1000 塊で
    // 実測 16.8ms）。日本語を打っているあいだ何度も走るので、変換中は直前の
    // 場所を保つ。
    if (!at) return view.composing ? "keep" : "native";
    const box = host.getBoundingClientRect();
    return {
      left: at.left - box.left,
      top: at.top - box.top,
      height: at.bottom - at.top,
    };
  };

  const apply = (spot: Spot) => {
    if (spot === "keep") return;
    if (spot === null || spot === "native") {
      hide();
      standard(spot === "native");
      return;
    }
    standard(false);
    const at = spot;
    const now = `${at.left},${at.top},${at.height}`;
    if (now === was && shown) return;
    was = now;

    bar.style.left = `${at.left}px`;
    bar.style.top = `${at.top}px`;
    bar.style.height = `${at.height}px`;
    if (!shown) {
      shown = true;
      bar.style.display = "block";
    }
    // 打っている間は点滅を止める。動くたびに頭から数え直す。
    // クラスを掛け直して offsetWidth を読む形にすると、そこで毎回
    // レイアウトが走る。
    for (const anim of bar.getAnimations()) anim.currentTime = 0;
  };

  return { measure, apply, stop: () => bar.remove() };
}

// 選んだ範囲を自分で描く。
//
// 事情はカーソルと同じ。標準の ::selection は行の箱に塗られるので、字の箱との
// 差がそのまま余白として塗られて字よりずっと高い帯になり、行内コードの箱や
// 箇条書きの記号のまわりでは塗りが途切れる。標準は index.css で消し、字の箱に
// 合わせた矩形をここで重ねる。
//
// 表のセルをまたぐ選択（.selectedCell）と塊そのものの選択
// （.ProseMirror-selectednode）には既に指定があるので、そちらに任せる。
function selectionBoxes(
  view: EditorView,
  host: HTMLElement,
  scroller: HTMLElement | null,
) {
  const layer = document.createElement("div");
  layer.className = "mg-sel";
  host.appendChild(layer);
  const boxes: HTMLDivElement[] = [];
  // 直前に描いた形。同じなら書き直さない。style を書くだけでレイアウトが
  // 無効になるので、動いていないときに書くのは丸損。
  let was = "";

  // live を渡すと、編集モデルの選択ではなくその範囲を測る。範囲を引いている
  // 間に使う（下の painter を参照）。
  const measure = (live: Span | null): Rect[] => {
    const { selection } = view.state;
    if (
      !live &&
      (selection.empty ||
        selection instanceof NodeSelection ||
        selection instanceof CellSelection)
    ) {
      return [];
    }
    const from = live ? live.from : selection.from;
    const to = live ? live.to : selection.to;
    if (to <= from) return [];
    const base = host.getBoundingClientRect();
    // 見えている帯。選択が数千行に渡っても、矩形を作るのは画面のぶんだけ。
    const seen = scroller?.getBoundingClientRect();
    const band = seen
      ? { top: seen.top, bottom: seen.bottom }
      : { top: 0, bottom: host.ownerDocument.documentElement.clientHeight };
    return selectionRects(view, from, to, band, base);
  };

  const apply = (rects: Rect[]) => {
    const now = rects.map((r) => `${r.left},${r.top},${r.width},${r.height}`).join("|");
    if (now === was) return;
    was = now;
    while (boxes.length > rects.length) boxes.pop()?.remove();
    while (boxes.length < rects.length) {
      const box = document.createElement("div");
      box.className = "mg-sel-box";
      layer.appendChild(box);
      boxes.push(box);
    }
    for (let i = 0; i < rects.length; i++) {
      const { left, top, width, height } = rects[i];
      const style = boxes[i].style;
      style.left = `${left}px`;
      style.top = `${top}px`;
      style.width = `${width}px`;
      style.height = `${height}px`;
    }
  };

  return { measure, apply, stop: () => layer.remove() };
}

// カーソルと選択の描き直しをまとめて受け持つ。
//
// 描き直すのは組み直しのときだけでは足りない。位置が変わる契機は他にもある。
// 測るとレイアウトが走るので、無駄に測らないための工夫が 2 つ入っている。
//
// 1 つ目は、測る前に「測らずに分かること」で足りるかを見ること。打鍵ごとに
// 打鍵・選択の変化・大きさの変化の 3 経路から合図が来るので、選択が同じで
// 位置も動いていないなら測らずに戻る。
//
// 2 つ目は、カーソルと選択をまとめて測ってからまとめて書くこと。style を
// 書くとレイアウトが無効になるので、書いた直後に測ると同期レイアウトが走る。
// 表のセルの範囲（行・列の選択を含む）を、丸ごと囲んで示す。
//
// 選んだセルを 1 つずつ塗ると、行を選んだときに桁の切れ目が透けて「何を
// 選んでいるのか」が読み取りにくい。Notion と同じく、塗らずに範囲を囲む。
// 囲みは 1 つなので、触っているセルの枠（is-focused）は選んでいるあいだ
// 出さない（tableKeys.ts）。
function cellsBox(view: EditorView, host: HTMLElement) {
  const box = document.createElement("div");
  box.className = "mg-cells";
  box.style.display = "none";
  host.appendChild(box);
  let was = "";

  const measure = (): Rect | null => {
    const { selection } = view.state;
    if (!(selection instanceof CellSelection)) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    selection.forEachCell((_node, pos) => {
      const dom = view.nodeDOM(pos);
      if (!(dom instanceof HTMLElement)) return;
      const rc = dom.getBoundingClientRect();
      if (rc.height <= 0) return;
      left = Math.min(left, rc.left);
      top = Math.min(top, rc.top);
      right = Math.max(right, rc.right);
      bottom = Math.max(bottom, rc.bottom);
    });
    if (right <= left || bottom <= top) return null;
    // 横に溢れる表は枠の中でスクロールする。見えている範囲で切る。
    //
    // 入れ物は選んでいる升目から辿る。本文の最初の表を当てにすると、2 つ目
    // 以降の表では切り抜きが効かず、スクロールで隠れている側にも枠が出る。
    const cell = view.nodeDOM(selection.$anchorCell.pos);
    const base = host.getBoundingClientRect();
    const clip =
      cell instanceof Element
        ? (cell.closest(".mg-table-wrap")?.getBoundingClientRect() ?? null)
        : null;
    if (clip) {
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
      if (right <= left) return null;
    }
    return {
      left: left - base.left,
      top: top - base.top,
      width: right - left,
      height: bottom - top,
    };
  };

  const apply = (at: Rect | null) => {
    if (!at) {
      if (was === "") return;
      was = "";
      box.style.display = "none";
      return;
    }
    const now = `${at.left},${at.top},${at.width},${at.height}`;
    if (now === was) return;
    was = now;
    box.style.left = `${at.left}px`;
    box.style.top = `${at.top}px`;
    box.style.width = `${at.width}px`;
    box.style.height = `${at.height}px`;
    box.style.display = "block";
  };

  return { measure, apply, stop: () => box.remove() };
}

function painter(view: EditorView, host: HTMLElement, scroller: HTMLElement | null) {
  // 選択を先に置く。同じ z-index なので、後から足したカーソルが上に来る。
  const boxes = selectionBoxes(view, host, scroller);
  const cells = cellsBox(view, host);
  const bar = caretBar(view, host);

  // 位置が変わる合図（スクロール・折り返し・焦点）の数。選択が同じでも
  // これが動いたら測り直す。
  let gen = 0;
  // 直前に描いたときの手掛かり。
  let sig = "";
  // 直前に描いたときの本文。
  //
  // 手掛かりの位置は、本文が変わっても同じ数字のままになることがある。項目の
  // 字下げ（Tab / Shift+Tab）がそれで、包み直しで閉じ札が開き札に置き換わる
  // だけなので、開き札の数＝位置が動かない。字は横へ動いているのに、位置が
  // 同じなら測り直さない作りだと、棒も帯も元の場所に残る。
  let drawn: PmNode | null = null;

  // 範囲を引いている間か。引いている間だけ DOM 側の選択から測る。
  let drawing = false;

  const paint = () => {
    const live = drawing ? domSpan(view) : null;
    const { from, to, head } = view.state.selection;
    const span = live ?? { from, to };
    const now = `${span.from},${span.to},${head},${view.composing ? 1 : 0},${gen}`;
    const doc = view.state.doc;
    if (now === sig && doc === drawn) return;
    sig = now;
    drawn = doc;
    const rects = boxes.measure(live);
    const cellsAt = cells.measure();
    // 引いている間はカーソルの棒を出さない（範囲を選んでいるので要らない）。
    const at = live ? null : bar.measure();
    boxes.apply(rects);
    cells.apply(cellsAt);
    bar.apply(at);
  };

  let frame = 0;
  const again = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  };
  // 位置が動いた合図。選択が同じでも測り直させる。
  const moved = () => {
    gen++;
    again();
  };
  // 引いている間は mousemove で描く。編集モデルの更新（selectionchange 経由）を
  // 待つと 1 番遅れる。
  const onMove = () => paint();
  const onUp = () => {
    if (!drawing) return;
    drawing = false;
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
    paint();
  };
  const onDown = (e: MouseEvent) => {
    if (e.button !== 0 || drawing) return;
    drawing = true;
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  };
  // 引き始めを拾うのは**スクロールする要素**。本文そのものに付けると、
  // 本文の外の余白から引き始めたときに速い経路へ入れない（実測で窓幅 1100 の
  // とき本文は 170〜930px、左右 170px ずつが余白で、ペインの横幅の 31%）。
  // そこから引くと selectionchange 経由の遅い経路に落ちて、帯が手に付いて
  // こない。
  //
  // 広く拾っても振る舞いは変わらない。編集面の中の選択でなければ domSpan が
  // null を返し、そのままモデル経由に落ちる。
  const catcher = scroller ?? view.dom;
  catcher.addEventListener("mousedown", onDown);
  view.dom.addEventListener("focus", moved);
  view.dom.addEventListener("blur", moved);
  // コードの塊のように中で横スクロールするものがある。scroll は上がって
  // こないので捕まえる側で拾う。
  view.dom.addEventListener("scroll", moved, true);
  // 組み直しを伴わない移動（⌘⌫ の既定動作など）はここで拾う。標準の選択が
  // 動いただけのときは、編集モデルの選択と同じなら測らずに戻る。
  document.addEventListener("selectionchange", again);
  // 字体の読み込み・折り返し・塊の開閉で高さが変わったら測り直す。見えている
  // 帯は入れ物の高さで決まるので、スクロール容器の大きさも見る。
  const watch = new ResizeObserver(moved);
  watch.observe(view.dom);
  if (scroller) watch.observe(scroller);

  return {
    // 打鍵と選択の変化はその場で描く。フレームをまたぐと、標準の塗りを
    // 消してある編集面では帯だけが 1 枚遅れて付いてきて、引いている手に
    // 対して重く見える。測るのは 900 ブロックでも 0.4ms で、待つ理由が無い。
    now: paint,
    // 位置が変わるだけの合図（スクロール・折り返し・焦点）はまとめる。
    draw: moved,
    stop: () => {
      onUp();
      catcher.removeEventListener("mousedown", onDown);
      view.dom.removeEventListener("focus", moved);
      view.dom.removeEventListener("blur", moved);
      view.dom.removeEventListener("scroll", moved, true);
      document.removeEventListener("selectionchange", again);
      watch.disconnect();
      cancelAnimationFrame(frame);
      bar.stop();
      cells.stop();
      boxes.stop();
    },
  };
}

export function BodyEditor({
  body,
  prefix,
  path,
  className,
  fontFamily,
  dark,
  resolveAsset,
  peekAsset,
  viewpoint,
  onViewpoint,
  onDom,
  onBuilt,
  onComment,
  onCopyLink,
  onAnchor,
  onNavigate,
  onChange,
  onSave,
  images,
  flushRef,
  adoptRef,
}: {
  body: string;
  // フロントマター。本文の前にそのまま戻す。
  prefix: string;
  // いま書いているファイル。トグルの開閉を覚える鍵に使う。
  path?: string | null;
  className?: string;
  // 読むときと同じ書体で書けるように、本文の入れ物と同じ指定を渡す。
  fontFamily?: string;
  // 図の明暗。mermaid は暗い / 明るいの 2 通りしか描き分けない。
  dark: boolean;
  // 相対パスの画像をローカルから解く。読むときと同じ経路。
  resolveAsset?: (src: string) => Promise<string | null>;
  peekAsset?: (src: string) => string | null;
  // 開いたときに合わせる位置。読むときと同じ持ち方（文字数と、そのブロックへ
  // 入り込んでいる画素）。
  viewpoint?: { at: number; into: number };
  onViewpoint?: (at: number, into: number) => void;
  // 編集面の要素。目次のように本文の DOM を見る側へ渡す。
  onDom?: (el: HTMLElement | null) => void;
  // 組み立てた編集面。指摘の印のように、編集モデルを見て本文の上へ重ねる
  // 側へ渡す。原文の控えは差し替わるので、値ではなく引く関数で渡す。
  onBuilt?: (built: Editing | null) => void;
  // ブロック全体への指摘。つまみのメニューに出す。
  onComment?: (pos: number) => void;
  // リンクを押したときの行き先。外（http）はここで開くので受けない。
  onAnchor?: (id: string) => void;
  onNavigate?: (href: string) => void;
  // その塗を指すリンクを写す。行き先（節）はここで出す。
  onCopyLink?: (section: Section | null) => void;
  // 組み直した本文。打鍵ごとではなく、手を止めてから届く。
  onChange: (raw: string) => void;
  onSave: () => void;
  // 画像の取り込み口。編集面はどのファイルを開いているかを知らないので、
  // 置き場所の判断は持たない。
  images?: ImageGoes;
  // 待たずに今すぐ届けさせる口。⌘S・編集を抜ける・窓を離れるときに使う。
  flushRef?: { current: (() => void) | null };
  // 外で書き換わった本文を入れる口。
  adoptRef?: { current: ((text: string) => void) | null };
}) {
  const host = useRef<HTMLDivElement>(null);
  const changed = useRef(onChange);
  const saved = useRef(onSave);
  // リンクの行き先。組み立ての閉包に捕まえると、ファイルを替えたときに古い
  // 行き先を掴んだままになるので、ref から読む。
  const links = useRef({ anchor: onAnchor, file: onNavigate });
  links.current = { anchor: onAnchor, file: onNavigate };
  // 画像の取り込み口も同じく、組み立ての閉包には捕まえない。
  const shots = useRef(images);
  shots.current = images;

  const moved = useRef(onViewpoint);
  // フロントマターは書いている最中にも差し替わる。組み立ての閉包に捕まえると
  // 次の保存で古いものを書き戻すので、毎描画で写して ref から読む。
  const fmText = useRef(prefix);
  changed.current = onChange;
  saved.current = onSave;
  moved.current = onViewpoint;
  fmText.current = prefix;

  // 組み上がった編集面。表のつまみのように、編集面の外側に重ねる React の
  // 部品へ渡す（層を編集面の中に置くと、ProseMirror が本文の書き換えと
  // 取り違える）。
  const [built, setBuilt] = useState<{
    view: EditorView;
    host: HTMLElement;
    scroller: HTMLElement | null;
  } | null>(null);

  // 札から行き先へ進む。押下の振り分け（linkClicks）と同じ道を通す。窓に
  // 任せると、アプリの中の道筋まで外のブラウザで開いてしまう。
  const goLink = (href: string) => {
    if (/^(https?:|mailto:|tel:)/.test(href)) {
      void openUrl(href);
      return;
    }
    if (href.startsWith("#")) {
      const id = href.slice(1);
      if (built) toAnchor(built.view, id, () => onAnchor?.(id));
      else onAnchor?.(id);
      return;
    }
    onNavigate?.(href);
  };

  // 拡大中の図。モーダルは React の側にあるので、NodeView からは合図だけ受ける。
  const [zoomed, setZoomed] = useState<{ svg: string; onEdit: () => void } | null>(
    null,
  );

  // 指しているリンク。行き先を見せる札と、打ち直しの入口を出す。
  //
  // 出す / 消すは手の位置で決める。入った・出たの通知で決めると、札は本文の
  // 外（body）に置いてあるぶん順番が絡み、手を運んだ途端に消える。
  const [onLink, setOnLink] = useState<{
    span: { from: number; to: number };
    href: string;
    // リンクそのものの矩形。ここと札の上に手があるあいだは出したままにする。
    link: { left: number; right: number; top: number; bottom: number };
    x: number;
    y: number;
  } | null>(null);
  const shownLink = useRef("");
  // リンクの行き先を聞いているところ。
  const [askLink, setAskLink] = useState<{
    span: { from: number; to: number };
    text: string;
    x: number;
    y: number;
  } | null>(null);
  // 札を消すのは、リンクからも札からも手が離れたとき。
  useEffect(() => {
    if (!onLink) return;
    const slack = 8;
    const over = (
      box: { left: number; right: number; top: number; bottom: number } | undefined,
      x: number,
      y: number,
    ) =>
      !!box &&
      x >= box.left - slack &&
      x <= box.right + slack &&
      y >= box.top - slack &&
      y <= box.bottom + slack;
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const card = document.querySelector(".mg-link-card")?.getBoundingClientRect();
        if (over(onLink.link, e.clientX, e.clientY) || over(card, e.clientX, e.clientY)) {
          return;
        }
        shownLink.current = "";
        setOnLink(null);
      });
    };
    // 本文が動けば、手はもうそのリンクの上に無い。手は動かないので
    // mousemove では気付けず、札だけが元の場所に取り残される。
    const gone = () => {
      shownLink.current = "";
      setOnLink(null);
    };
    document.addEventListener("mousemove", onMove);
    window.addEventListener("scroll", gone, true);
    window.addEventListener("resize", gone);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", gone, true);
      window.removeEventListener("resize", gone);
    };
  }, [onLink]);

  // 打ち直している式。位置はプラグインが持っているので、ここは出す場所と
  // いま見せている中身だけを控える。
  const [math, setMath] = useState<{
    pos: number;
    tex: string;
    lines: boolean;
    x: number;
    y: number;
  } | null>(null);

  // ":" と /emoji から出す盤。位置と絞り込みはプラグインが持っているので、
  // ここは出す場所だけを控える。
  const [emoji, setEmoji] = useState<{
    x: number;
    y: number;
    query: string;
    active: number;
    bare?: boolean;
  } | null>(null);

  // 開いているアイコンの盤。押されたときに差し替えの手ごと持つので、後から
  // 節点を探し直さない。seq は開くたびに増やし、盤を作り直させる。
  const [picking, setPicking] = useState<{
    seq: number;
    x: number;
    y: number;
    apply: (icon: string) => void;
  } | null>(null);

  // 専用の描画が要るもの（図・画像）へ渡す口。編集面を作り直さずに差し替えたい
  // ものだけを持つので、中身は書き換えて使う。
  const deps = useRef<EditorDeps>({
    dark,
    modes: new Map(),
    redraws: new Set(),
    onZoom: (svg, onEdit) => setZoomed({ svg, onEdit }),
  });
  deps.current.resolveAsset = resolveAsset;
  deps.current.peekAsset = peekAsset;
  deps.current.path = path;

  // 書体は設定で後から変わる。組み立て直しは本文の大きさに比例して高いので、
  // 編集面の要素へ直に書く（EditorView の attributes は組み立てた時点で
  // 固まるため、渡し直すには作り直しになる）。
  useEffect(() => {
    if (!built || built.view.isDestroyed) return;
    built.view.dom.style.fontFamily = fontFamily ?? "";
  }, [built, fontFamily]);

  // テーマの明暗が変わったら、開いている図を描き直す。図は明暗の 2 通りしか無い。
  useEffect(() => {
    if (deps.current.dark === dark) return;
    deps.current.dark = dark;
    for (const redraw of deps.current.redraws) redraw();
  }, [dark]);

  useEffect(() => {
    const at = host.current;
    if (!at) return;
    // 解析はメインスレッドの外でやる（parseAway → Worker）。
    //
    // remark の解析は本文の大きさに比例して重く、2000 ブロックで実測 285ms、
    // 4000 ブロックで 441ms。メインスレッドで走らせるとその間ブラウザは 1 枚も
    // 塗れず、押下も処理されない。受け渡しは 24ms / 36ms で済むので、外へ出す。
    //
    // 返ってくるまでは骨組みのまま待つ。待っている間もメインスレッドは空いて
    // いるので、ツリーは即座に反応する。
    let dead = false;
    let stop: (() => void) | null = null;
    const asked = parseAway(body);
    if (asked instanceof Promise) {
      void asked.then((got) => {
        // 待っている間に片付けられていたら捨てる。
        if (dead) return;
        stop = build(got, at);
      });
    } else {
      // Worker が使えないときはその場で組む。
      stop = build(asked, at);
    }
    return () => {
      dead = true;
      stop?.();
    };

    // 以下は解析が返ってきてから走る。片付けの手を返す。
    function build(parsed: Loaded, at: HTMLDivElement): () => void {
      const scroller = scrollerOf(at);

      // 外で書き換わったら差し替えるので、土台は入れ替わる。
      let loaded = parsed;
      const blocks = blocksOf(loaded);
      const want = Math.max(0, (viewpoint?.at ?? 0) - fmText.current.length);
      const target = want > 0 ? (blocks.find((b) => b.end > want) ?? null) : null;

      // 編集面は段階的に組む。
      //
      // 費用の本体は組み立てではなく**焦点を当てること**で、長い
      // contenteditable では WebKit 側の仕事が本文の大きさに比例する
      // （2000 ブロックで実測 375ms。preventScroll でも変わらない）。
      // 先頭の数十ブロックだけで作って**小さいうちに焦点を当て**、残りを
      // 後から足せば、そこが数 ms で済む。
      //
      // 合わせ先（見ていた場所）は最初の分に含める。含めないと、そこへ届く
      // まで画面が先頭に留まる。
      const whole = loaded.doc;
      const total = whole.childCount;
      // 合わせ先を含む子の番号。target.pos は全文での位置だが、先頭からの子は
      // 途中の doc でも同じ位置に並ぶので、その子まで入れておけば resolve できる。
      let upto = 0;
      if (target) {
        let scan = 0;
        for (let i = 0; i < total; i++) {
          if (scan >= target.pos) break;
          scan += whole.child(i).nodeSize;
          upto = i + 1;
        }
      }
      // 最初に入れる子の数。画面に出る分 + 余白。
      const FIRST = 40;
      let grown = Math.min(total, Math.max(FIRST, upto + FIRST));
      // 育ち中は書き出さない・打たせない。途中の doc を直列化すると
      // ファイルが切り詰められる。
      // 育てる方式は末尾へ足すたびに ProseMirror が doc を突き合わせるので、
      // 1 回が本文の大きさに比例する（全体では二乗）。小さいうちは焦点を
      // 小さい doc で当てられる分が大きく勝つが、大きい本文では負ける。
      // 境目は実測で決める。
      // 実測で決めた境目。900 ブロックでは最長の塊が 419ms → 199ms、塞がる合計も
      // 743ms → 370ms に下がる。2000 ブロックでは足す回数が増えて合計が伸び、
      // 育ち切るまでに数秒かかるので、そこは今までどおり一度で組む。
      const GROW_MAX = 1200;
      let growing = grown < total && total <= GROW_MAX;
      if (!growing) grown = total;
      const head = (n: number): PmNode => {
        const kids: PmNode[] = [];
        for (let i = 0; i < n; i++) kids.push(whole.child(i));
        return whole.type.create(whole.attrs, Fragment.fromArray(kids));
      };
      const first = growing ? head(grown) : whole;

      const state = EditorState.create({
        doc: first,
        // 焦点を当てると選んでいるところへ画面が動く。合わせたい位置を先に選んでおく。
        selection: target
          ? TextSelection.near(
              first.resolve(Math.min(target.pos + 1, first.content.size)),
            )
          : undefined,
        plugins: editorPlugins({
          onSave: () => saved.current(),
          // 押した先は呼び出し側が決める。編集面はどのファイルを開いているかを
          // 知らないので、行き先の判断まで持たない。
          links: {
            out: (href) => void openUrl(href),
            anchor: (id) => toAnchor(view, id, () => links.current.anchor?.(id)),
            file: (href) => links.current.file?.(href),
          },
          images: {
            stow: (incoming) => shots.current?.stow(incoming) ?? Promise.resolve(null),
            take: (at) => shots.current?.take(at) ?? Promise.resolve(null),
            pick: () => shots.current?.pick() ?? Promise.resolve(null),
            copy: (src) => shots.current?.copy(src),
          },
        }),
      });

      const view = new EditorView(at, {
        state,
        nodeViews: nodeViews(deps.current),
        attributes: { class: `mg-pm ${className ?? ""}`.trim() },
        handleDOMEvents: {
          // 押した拍子に書いていた場所を見失わないようにする。
          mousedown(_here, event) {
            if (!icoOf(event)) return false;
            event.preventDefault();
            return true;
          },
          // 囲みのアイコンを押したら、読むときと同じ盤を出す。
          //
          // 出すのは click。mousedown で出すと、盤が付ける「外を押したら閉じる」
          // （mousedown を見ている）が、まだ配り終えていないその押下を受け取り、
          // 出した端から閉じてしまう。
          click(here, event) {
            const ico = icoOf(event);
            const hit = ico && calloutIcoAt(here, event.target);
            if (ico && hit) {
              event.preventDefault();
              const box = ico.getBoundingClientRect();
              setPicking((was) => ({
                seq: (was?.seq ?? 0) + 1,
                x: box.left,
                y: box.bottom + 6,
                apply: (value) => setCalloutIcon(here, hit.pos, value),
              }));
              return true;
            }
            // 本文の絵文字も押したら選び直せる。囲みのアイコンと同じ盤を出す。
            //
            // 範囲を選んだ流れ（引いて離した）と、修飾キーを押しながらの
            // 押下では出さない。
            const bare =
              !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
            const sel = here.dom.ownerDocument.getSelection();
            if (!bare || (sel && !sel.isCollapsed)) return false;
            const span = emojiSpanAt(here, event.clientX, event.clientY);
            if (!span) return false;
            event.preventDefault();
            let box: { left: number; bottom: number };
            try {
              box = here.coordsAtPos(span.from);
            } catch {
              return false;
            }
            setPicking((was) => ({
              seq: (was?.seq ?? 0) + 1,
              x: box.left,
              y: box.bottom + 6,
              apply: (value) => swapEmoji(here, span, value),
            }));
            return true;
          },
        },
        dispatchTransaction(tr) {
          const next = view.state.apply(tr);
          view.updateState(next);
          // 打鍵の経路に置くのはここまで。組み直しは手を止めてから。
          if (tr.docChanged) send();
          // 育てる分では描き直さない。末尾へ足すだけでカーソルも選択も動かない。
          // ここは本文の大きさに比例するので、足すたびに走ると育つのが遅くなる。
          if (tr.getMeta(GROW)) return;
          // 人が打ったなら、残りを一気に入れて普通の状態へ戻す。育ち中は
          // 書き出しを止めているので、そのままでは打ったものが保存されない。
          if (tr.docChanged) fillRest();
          paint.now();
          showEmoji(view);
          showMath(view);
        },
      });
      const paint = painter(view, at, scroller);

      // 絵文字の上では手の形にする。押して選び直せることを見せる。
      //
      // 走査はしない。まず指している要素の字に絵文字が無ければそこで終わり
      // （正規表現 1 回）。あるときだけ位置を出して、その 1 文字を確かめる。
      // 見るのは 1 フレームに 1 回。
      let onEmoji = false;
      let looking = 0;
      const hover = (event: MouseEvent) => {
        if (looking) return;
        looking = requestAnimationFrame(() => {
          looking = 0;
          const el = event.target instanceof Element ? event.target : null;
          // 指している 1 文字を見る。指している要素の字で先にふるうことは
          // できない（本文の上に重ねた層が相手になることがあり、その字は
          // 本文ではない）。位置を聞くのは実測 0〜1ms なので、フレームごとに
          // 1 回で足りる。
          const on = !!emojiSpanAt(view, event.clientX, event.clientY);
          if (on !== onEmoji) {
            onEmoji = on;
            view.dom.classList.toggle("mg-over-emoji", on);
          }

          // リンクの札。出すだけで、消すのは手の位置を見ている側に任せる。
          const a = el?.closest("a");
          const box = a?.getBoundingClientRect();
          const at = a ? view.posAtDOM(a, 0) : -1;
          const span = at >= 0 ? linkSpanAt(view.state, at + 1) : null;
          const key = span && box ? `${span.from},${span.to}` : "";
          if (key === shownLink.current) return;
          shownLink.current = key;
          if (!span || !box) return;
          setOnLink({
            span,
            href: span.href,
            link: {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
            },
            x: box.left,
            y: box.bottom + 4,
          });
        });
      };
      view.dom.addEventListener("mousemove", hover);

      // 絵文字の盤を出す / 消す。打鍵のたびに React を描き直さないよう、
      // 変わったときだけ控えを差し替える。
      let shown = "";
      const showEmoji = (v: EditorView) => {
        const now = emojiKey.getState(v.state);
        const sig = now
          ? `${now.from},${now.query},${now.active},${now.bare ? 1 : 0}`
          : "";
        if (sig === shown) return;
        shown = sig;
        if (!now) {
          setEmoji(null);
          return;
        }
        let spot: { top: number; bottom: number; left: number };
        try {
          spot = v.coordsAtPos(now.from);
        } catch {
          setEmoji(null);
          return;
        }
        setEmoji({
          x: spot.left,
          y: spot.bottom + 6,
          query: now.query,
          active: now.active,
          bare: now.bare,
        });
      };

      // 式の入力欄を出す / 消す。位置と対象はプラグインが持つ。
      let editing = -1;
      const showMath = (v: EditorView) => {
        const at = mathKey.getState(v.state) ?? -1;
        if (at === editing) return;
        editing = at;
        const node = at < 0 ? null : v.state.doc.nodeAt(at);
        if (!node) {
          setMath(null);
          return;
        }
        const lines = node.type === schema.nodes.mathBlock;
        // 独立した式は塊の下へ出す。位置から出すと塊の頭を指すので、そのままでは
        // 式そのものを覆う。行内の式は字の下でよい。
        const dom = lines ? v.nodeDOM(at) : null;
        let spot: { left: number; bottom: number };
        if (dom instanceof HTMLElement) {
          spot = dom.getBoundingClientRect();
        } else {
          try {
            spot = v.coordsAtPos(at);
          } catch {
            setMath(null);
            return;
          }
        }
        setMath({
          pos: at,
          tex: node.attrs.tex as string,
          lines,
          x: spot.left,
          y: spot.bottom + 8,
        });
      };

      // 組み直して親へ渡す。ここだけが重いので、打鍵の経路から外してある。
      const send = throttled(
        () => {
          // 育ち切るまでは書き出さない。toMarkdown は doc 全体を直列化するので、
          // 途中の doc を渡すとファイルが切り詰められる。ここ 1 か所で止めれば
          // 打鍵・⌘S・窓を離れたとき・後片付けの全部が塞がる。
          if (growing) return;
          changed.current(fmText.current + toMarkdown(view.state.doc, loaded));
        },
        WAIT,
        CAP,
      );
      if (flushRef) flushRef.current = () => send.flush();

      // 外で書き換わった本文を取り込む。
      //
      // React ごと作り直さない。作り直すと編集面・プラグイン・専用の描画・
      // カーソルの描画まで全部作り直しになる。差し替えを 1 つの transaction で
      // 流せば、ProseMirror が古い doc と差分を取って変わったところの DOM だけ
      // 触る。スクロール位置も自然に保たれる。
      // 育ち中に来た外の変更。育ち切ってから当て直す。
      let waiting: string | null = null;
      const adopt = (text: string) => {
        // 変換中は本文に触らない。差し替えると節点が組み直され、IME が抱えて
        // いる変換中の字が本文から外れる。外れた字は確定のときにもう一度
        // 入るので、同じ文が二重に残る。
        if (growing || view.composing) {
          waiting = text;
          return;
        }
        // 変わったところだけ読み直せるならそれで済ませる。大きいファイルでは
        // 全体の読み直しが 350ms 掛かる（929 ブロックで実測）。
        const spot = reload(loaded, text);
        if (spot) {
          loaded = spot.loaded;
          view.dispatch(
            view.state.tr
              .replaceWith(spot.from, spot.to, spot.content)
              // 外の変更は編集面の ⌘Z に積まない。自分が打ったものではない。
              .setMeta("addToHistory", false),
          );
        } else {
          const whole = fromMarkdown(text);
          loaded = whole;
          view.dispatch(
            view.state.tr
              .replaceWith(0, view.state.doc.content.size, whole.doc.content)
              .setMeta("addToHistory", false),
          );
        }
        // 取り込んだ本文はそのまま親の控えでもある。組み直しの予約は捨てる。
        send.cancel();
        paint.now();
      };
      if (adoptRef) adoptRef.current = adopt;
      // 変換が終わったら、待たせていた分を入れる。
      const afterCompose = () => {
        if (waiting === null) return;
        const text = waiting;
        waiting = null;
        adopt(text);
      };
      view.dom.addEventListener("compositionend", afterCompose);
      // 窓を離れるときは待たずに流す。戻ってこないこともある。
      const onLeave = () => send.flush();
      window.addEventListener("blur", onLeave);
      document.addEventListener("visibilitychange", onLeave);

      onDom?.(view.dom);
      setBuilt({ view, host: at, scroller });
      // 焦点は当てない。当てると、読んでいる間も OS が入力モードの印を出す
      // （カーソルの位置に「あ」などが浮き、画面の外へ送ると端に居座る）。
      // 触ったときに渡す（本文を押す、または字を打ち始める）。
      paint.draw();

      // 触れる状態になったと親へ知らせる。
      //
      // 組み上がった時点ではまだ言えない。この後に見ていた場所へ合わせ込みが
      // 走り、実測で 800ms ほど本文が流れ続ける（900 ブロックで組み上がり
      // 351ms → 落ち着き 1444ms）。そこで骨組みを外すと、字は出ていて焦点も
      // あるのに本文が動いていく状態になる。**落ち着いてから知らせる。**
      // 触れる状態になったと親へ知らせるのは、「育ち切った」かつ
      // 「合わせ込みが落ち着いた」の両方が揃ってから。
      let aligned = false;
      let told = false;
      const tell = () => {
        if (growing || !aligned || told) return;
        told = true;
        onBuilt?.({ view, host: at, loaded: () => loaded });
      };
      const ready = () => {
        aligned = true;
        tell();
      };

      // 残りの子を少しずつ足す。
      //
      // 1 回に足す数は測って寄せる。ブロックの種類で 1 つの重さが変わるので、
      // 個数で決め打ちすると 1 フレームに収まらない。
      const GROW_MS = 8;
      let batch = 24;
      let rafGrow = 0;
      // 残りをまとめて入れる。打鍵が来たときに使う。
      const fillRest = () => {
        if (!growing) return;
        cancelAnimationFrame(rafGrow);
        rafGrow = 0;
        const rest: PmNode[] = [];
        for (let i = grown; i < total; i++) rest.push(whole.child(i));
        grown = total;
        growing = false;
        if (rest.length > 0) {
          // 打鍵の処理の中からは流せないので、ひと呼吸おいて入れる。
          queueMicrotask(() => {
            if (view.isDestroyed) return;
            view.dispatch(
              view.state.tr
                .insert(view.state.doc.content.size, Fragment.fromArray(rest))
                .setMeta("addToHistory", false)
                .setMeta(GROW, true),
            );
            tell();
          });
          return;
        }
        tell();
      };
      const grow = () => {
        rafGrow = 0;
        const take = Math.min(batch, total - grown);
        const kids: PmNode[] = [];
        for (let i = 0; i < take; i++) kids.push(whole.child(grown + i));
        grown += take;
        const t0 = performance.now();
        view.dispatch(
          view.state.tr
            .insert(view.state.doc.content.size, Fragment.fromArray(kids))
            // 育てる分は ⌘Z に積まない。打ったものではない。
            .setMeta("addToHistory", false)
            // 末尾へ足すだけ、と受け取る側へ伝える。既にある位置は動かないので、
            // 位置の写し直しや描き直しを省ける（そこが本文の大きさに比例する）。
            .setMeta(GROW, true),
        );
        const took = Math.max(0.5, performance.now() - t0);
        // 次の量は「1 フレームに収まるはず」の数へ寄せる。振れないよう、
        // 前の量から離れすぎないところで止める。
        const want = (take * GROW_MS) / took;
        batch = Math.max(8, Math.min(400, Math.round((batch + want) / 2)));
        if (grown < total) {
          rafGrow = requestAnimationFrame(grow);
          return;
        }
        growing = false;
        if (waiting !== null) {
          const text = waiting;
          waiting = null;
          adopt(text);
        }
        tell();
      };
      if (growing) rafGrow = requestAnimationFrame(grow);

      // 開いた位置へ合わせる。字体や画像で高さが決まるまで数フレームかかる。
      // 動かなくなったら打ち切る（回数で決め打ちすると、落ち着いた後も待つ）。
      let raf = 0;
      if (scroller && target) {
        // 打ち切りまでの枚数。合わせ込みは 1 度では終わらない（上のブロックの
        // 高さが字体や画像で決まっていく分だけ狙いが動く）。実測で 900 ブロック
        // では落ち着くまで 500ms ほどかかるので、そこを待てる枚数にしておく。
        let left = 45;
        let still = 0;
        const align = () => {
          let moved = false;
          try {
            const dom = view.nodeDOM(target.pos);
            const el = dom instanceof HTMLElement ? dom : null;
            if (el) {
              const delta =
                el.getBoundingClientRect().top -
                scroller.getBoundingClientRect().top +
                (viewpoint?.into ?? 0);
              if (Math.abs(delta) > 0.5) {
                scroller.scrollTop += delta;
                moved = true;
              }
            }
          } catch {
            // 測れないときは合わせるのを諦める。ここで止まると骨組みが
            // 外れないまま残る（触れないより、ずれて出す方がまし）。
            ready();
            return;
          }
          still = moved ? 0 : still + 1;
          if (still >= 3 || --left <= 0) {
            ready();
            return;
          }
          raf = requestAnimationFrame(align);
        };
        raf = requestAnimationFrame(align);
      } else {
        // 戻る場所が無ければ先頭から。スクロールする入れ物は編集面の外に
        // あって前のファイルのときのまま残るので、ここで戻さないと別の
        // ファイルの位置を引き継いでしまう。
        if (scroller) scroller.scrollTop = 0;
        ready();
      }

      // 動かした位置を控える。読むときと同じ数え方（原文の先頭からの文字数）。
      //
      // 上端にあるブロックは DOM に聞く。先頭から順に測ると、1 フレームで
      // ブロックの数だけ強制レイアウトが走る（本文が大きいほど遅くなり、
      // ドラッグで端まで引いたときの自動スクロールで体感に出る）。
      let tick = 0;
      const onScroll = () => {
        // 選択の矩形は見えている範囲のぶんしか無いので、動いたら描き足す。
        // 中で 1 フレームにまとめられるので、そのまま呼ぶ。
        paint.draw();
        if (!scroller || !moved.current) return;
        cancelAnimationFrame(tick);
        tick = requestAnimationFrame(() => {
          const box = scroller.getBoundingClientRect();
          // 聞く点は本文の中に置く。入れ物の左端は横の余白と中央寄せのぶん
          // 本文より外側にあり（実測で 166px）、そこを聞くと posAtCoords は
          // 毎回 null を返す。null を 0 と同じに扱うと、控えは常に本文の先頭に
          // なり「戻ってくると頭に居る」になる。聞けなかったら控えを触らない。
          const inner = view.dom.getBoundingClientRect();
          const hit = view.posAtCoords({ left: inner.left + 8, top: box.top + 1 });
          if (!hit) return;
          const $at = view.state.doc.resolve(
            Math.min(hit.pos, view.state.doc.content.size),
          );
          const start = $at.depth > 0 ? $at.before(1) : 0;
          const seen = seenAt(view.state.doc, loaded, start);
          if (!seen) return;
          const dom = view.nodeDOM(seen.pos);
          const el = dom instanceof HTMLElement ? dom : null;
          const into = el ? Math.max(0, box.top - el.getBoundingClientRect().top) : 0;
          moved.current?.(fmText.current.length + seen.at, into);
        });
      };
      scroller?.addEventListener("scroll", onScroll, { passive: true });

      return () => {
        cancelAnimationFrame(raf);
        cancelAnimationFrame(rafGrow);
        cancelAnimationFrame(tick);
        scroller?.removeEventListener("scroll", onScroll);
        window.removeEventListener("blur", onLeave);
        document.removeEventListener("visibilitychange", onLeave);
        // 片付ける前に書きかけを流す。ここで捨てると、ファイルを切り替えた
        // ときに打ったものが消える。
        send.flush();
        if (flushRef) flushRef.current = null;
        if (adoptRef) adoptRef.current = null;
        cancelAnimationFrame(looking);
        view.dom.removeEventListener("mousemove", hover);
        view.dom.removeEventListener("compositionend", afterCompose);
        paint.stop();
        setBuilt(null);
        onBuilt?.(null);
        onDom?.(null);
        view.destroy();
      };
    }
    // 本文を差し替えるのはファイルを開き直したときだけ。呼び出し側が key で作り直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* 編集面は ProseMirror が中の DOM を持つ。React の子は入れない。 */}
      <div ref={host} className="relative" />
      {built && (
        <EditorGutter
          view={built.view}
          host={built.host}
          scroller={built.scroller}
          onComment={onComment}
          onCopyLink={(pos) => onCopyLink?.(anchorTo(built.view.state.doc, pos))}
          images={images}
        />
      )}
      {picking && (
        <EmojiBoard
          key={picking.seq}
          x={picking.x}
          y={picking.y}
          onPick={(value) => {
            picking.apply(value);
            setPicking(null);
          }}
          onClear={() => {
            picking.apply("");
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}

      {/* 指しているリンクの札。行き先を見せ、打ち直しの入口を出す。 */}
      {built && onLink && !askLink && (
        <LinkCard
          href={onLink.href}
          at={{ left: onLink.x, top: onLink.y }}
          onOpen={() => {
            const href = onLink.href;
            setOnLink(null);
            goLink(href);
          }}
          onEdit={() => {
            setAskLink({
              span: onLink.span,
              text: onLink.href,
              x: onLink.x,
              y: onLink.y,
            });
            // 打ち直しているあいだ、本文の側でもそのリンクに印を付ける。
            markEditing(built.view, onLink.span);
            setOnLink(null);
          }}
        />
      )}

      {/* リンクの行き先を聞く小窓。相手は選んだ範囲ではなくそのリンク。 */}
      {built && askLink && (
        <AskBox
          hint="https://…"
          label="リンクの行き先"
          text={askLink.text}
          at={{ left: askLink.x, top: askLink.y }}
          onText={(text) => setAskLink({ ...askLink, text })}
          onDone={() => {
            relink(askLink.span, askLink.text.trim())(
              built.view.state,
              built.view.dispatch,
              built.view,
            );
            markEditing(built.view, null);
            setAskLink(null);
            built.view.focus();
          }}
          onClose={() => {
            markEditing(built.view, null);
            setAskLink(null);
          }}
        />
      )}

      {/* 式の中身を聞く小窓。位置と対象はプラグインが持つ。 */}
      {built && math && (
        <AskBox
          hint="E = mc^2"
          label={math.lines ? "式（TeX）" : "行内の式（TeX）"}
          text={math.tex}
          lines={math.lines}
          at={{ left: math.x, top: math.y }}
          onText={(tex) => {
            setMath({ ...math, tex });
            // 打っているそばから組み直す。決めるまで見た目が変わらないと、
            // 記号が合っているかを確かめられない。
            liveMath(built.view, math.pos, tex);
          }}
          onDone={() => {
            applyMath(built.view, math.pos, math.tex);
            built.view.focus();
          }}
          onClose={() => {
            // 中身が空のまま閉じたら節点ごと消す（中身の無い式を残さない）。
            applyMath(built.view, math.pos, math.tex);
            closeMath(built.view);
            built.view.focus();
          }}
        />
      )}

      {/* 本文の ":" と /emoji から出す盤。位置と絞り込みはプラグインが持つ。 */}
      {built && emoji && (
        <EmojiBoard
          x={emoji.x}
          y={emoji.y}
          query={emoji.bare ? undefined : emoji.query}
          active={emoji.bare ? undefined : emoji.active}
          onPick={(char) => takeEmoji(built.view, char)}
          onClose={() => closeEmoji(built.view)}
        />
      )}
      {zoomed && (
        <MermaidModal
          svg={zoomed.svg}
          dark={dark}
          onEdit={() => {
            const edit = zoomed.onEdit;
            setZoomed(null);
            edit();
          }}
          onClose={() => setZoomed(null)}
        />
      )}
    </>
  );
}

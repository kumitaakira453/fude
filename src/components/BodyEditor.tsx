import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
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
import { nodeViews, type EditorDeps } from "../lib/md/nodeViews";
import { reload } from "../lib/md/reload";
import { editorPlugins } from "../lib/md/plugins";
import { selectionRects, type Rect } from "../lib/md/selectionRects";
import { toMarkdown } from "../lib/md/toMarkdown";
import { IconBoard } from "./CalloutIcon";
import { TableGrips } from "./TableGrips";
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
function caretBar(view: EditorView, host: HTMLElement) {
  const bar = document.createElement("div");
  bar.className = "mg-caret is-idle";
  bar.style.display = "none";
  host.appendChild(bar);

  // 直前に描いた場所。同じなら書き直さない。style を書くだけでレイアウトが
  // 無効になるので、動いていないときに書くのは丸損。
  let was = "";
  // 棒を出しているか。入れ物のクラスは子孫セレクタで効いているので、
  // 付け外しのたびに編集面の配下まるごとのスタイル再計算が走る。範囲を
  // 選んでいる間は選択の変化が連続で来るため、変わったときだけ触る。
  let shown = false;

  const hide = () => {
    if (!shown) return;
    shown = false;
    was = "";
    bar.style.display = "none";
    host.classList.remove("mg-caret-on");
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

  const measure = (): { left: number; top: number; height: number } | null => {
    const { selection } = view.state;
    if (!selection.empty || !view.hasFocus()) return null;
    // 隠れているところ（図だけを出している塊の中など）は測れない。
    let at: { left: number; top: number; bottom: number } | null = null;
    try {
      at = view.composing ? fromDom() : view.coordsAtPos(selection.head);
    } catch {
      at = null;
    }
    if (!at) return null;
    const box = host.getBoundingClientRect();
    return {
      left: at.left - box.left,
      top: at.top - box.top,
      height: at.bottom - at.top,
    };
  };

  const apply = (at: { left: number; top: number; height: number } | null) => {
    if (!at) {
      hide();
      return;
    }
    const now = `${at.left},${at.top},${at.height}`;
    if (now === was && shown) return;
    was = now;

    bar.style.left = `${at.left}px`;
    bar.style.top = `${at.top}px`;
    bar.style.height = `${at.height}px`;
    if (!shown) {
      shown = true;
      bar.style.display = "block";
      host.classList.add("mg-caret-on");
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

  const measure = (): Rect[] => {
    const { selection } = view.state;
    if (
      selection.empty ||
      selection instanceof NodeSelection ||
      selection instanceof CellSelection
    ) {
      return [];
    }
    const base = host.getBoundingClientRect();
    // 見えている帯。選択が数千行に渡っても、矩形を作るのは画面のぶんだけ。
    const seen = scroller?.getBoundingClientRect();
    const band = seen
      ? { top: seen.top, bottom: seen.bottom }
      : { top: 0, bottom: host.ownerDocument.documentElement.clientHeight };
    return selectionRects(view, selection.from, selection.to, band, base);
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
function painter(view: EditorView, host: HTMLElement, scroller: HTMLElement | null) {
  // 選択を先に置く。同じ z-index なので、後から足したカーソルが上に来る。
  const boxes = selectionBoxes(view, host, scroller);
  const bar = caretBar(view, host);

  // 位置が変わる合図（スクロール・折り返し・焦点）の数。選択が同じでも
  // これが動いたら測り直す。
  let gen = 0;
  // 直前に描いたときの手掛かり。
  let sig = "";

  const paint = () => {
    const { from, to, head } = view.state.selection;
    const now = `${from},${to},${head},${view.composing ? 1 : 0},${gen}`;
    if (now === sig) return;
    sig = now;
    const rects = boxes.measure();
    const at = bar.measure();
    boxes.apply(rects);
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
      view.dom.removeEventListener("focus", moved);
      view.dom.removeEventListener("blur", moved);
      view.dom.removeEventListener("scroll", moved, true);
      document.removeEventListener("selectionchange", again);
      watch.disconnect();
      cancelAnimationFrame(frame);
      bar.stop();
      boxes.stop();
    },
  };
}

export function BodyEditor({
  body,
  prefix,
  className,
  fontFamily,
  dark,
  resolveAsset,
  peekAsset,
  viewpoint,
  onViewpoint,
  onDom,
  onChange,
  onSave,
  flushRef,
  adoptRef,
}: {
  body: string;
  // フロントマター。本文の前にそのまま戻す。
  prefix: string;
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
  // 組み直した本文。打鍵ごとではなく、手を止めてから届く。
  onChange: (raw: string) => void;
  onSave: () => void;
  // 待たずに今すぐ届けさせる口。⌘S・編集を抜ける・窓を離れるときに使う。
  flushRef?: { current: (() => void) | null };
  // 外で書き換わった本文を入れる口。
  adoptRef?: { current: ((text: string) => void) | null };
}) {
  const host = useRef<HTMLDivElement>(null);
  const changed = useRef(onChange);
  const saved = useRef(onSave);
  const moved = useRef(onViewpoint);
  changed.current = onChange;
  saved.current = onSave;
  moved.current = onViewpoint;

  // 組み上がった編集面。表のつまみのように、編集面の外側に重ねる React の
  // 部品へ渡す（層を編集面の中に置くと、ProseMirror が本文の書き換えと
  // 取り違える）。
  const [built, setBuilt] = useState<{
    view: EditorView;
    host: HTMLElement;
    scroller: HTMLElement | null;
  } | null>(null);

  // 拡大中の図。モーダルは React の側にあるので、NodeView からは合図だけ受ける。
  const [zoomed, setZoomed] = useState<{ svg: string; onEdit: () => void } | null>(
    null,
  );

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

  // テーマの明暗が変わったら、開いている図を描き直す。図は明暗の 2 通りしか無い。
  useEffect(() => {
    if (deps.current.dark === dark) return;
    deps.current.dark = dark;
    for (const redraw of deps.current.redraws) redraw();
  }, [dark]);

  useEffect(() => {
    const at = host.current;
    if (!at) return;
    const scroller = scrollerOf(at);

    // 外で書き換わったら差し替えるので、土台は入れ替わる。
    let loaded = fromMarkdown(body);
    let blocks = blocksOf(loaded);
    const want = Math.max(0, (viewpoint?.at ?? 0) - prefix.length);
    const target = want > 0 ? (blocks.find((b) => b.end > want) ?? null) : null;

    const state = EditorState.create({
      doc: loaded.doc,
      // 焦点を当てると選んでいるところへ画面が動く。合わせたい位置を先に選んでおく。
      selection: target
        ? TextSelection.near(loaded.doc.resolve(target.pos + 1))
        : undefined,
      plugins: editorPlugins({ onSave: () => saved.current() }),
    });

    const view = new EditorView(at, {
      state,
      nodeViews: nodeViews(deps.current),
      attributes: {
        class: `mg-pm ${className ?? ""}`.trim(),
        ...(fontFamily ? { style: `font-family: ${fontFamily}` } : {}),
      },
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
          if (!ico || !hit) return false;
          event.preventDefault();
          const box = ico.getBoundingClientRect();
          setPicking((was) => ({
            seq: (was?.seq ?? 0) + 1,
            x: box.left,
            y: box.bottom + 6,
            apply: (value) => setCalloutIcon(here, hit.pos, value),
          }));
          return true;
        },
      },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        // 打鍵の経路に置くのはここまで。組み直しは手を止めてから。
        if (tr.docChanged) send();
        paint.now();
      },
    });
    const paint = painter(view, at, scroller);

    // 組み直して親へ渡す。ここだけが重いので、打鍵の経路から外してある。
    const send = throttled(
      () => changed.current(prefix + toMarkdown(view.state.doc, loaded)),
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
    const adopt = (text: string) => {
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
      blocks = blocksOf(loaded);
      // 取り込んだ本文はそのまま親の控えでもある。組み直しの予約は捨てる。
      send.cancel();
      paint.now();
    };
    if (adoptRef) adoptRef.current = adopt;
    // 窓を離れるときは待たずに流す。戻ってこないこともある。
    const onLeave = () => send.flush();
    window.addEventListener("blur", onLeave);
    document.addEventListener("visibilitychange", onLeave);

    onDom?.(view.dom);
    setBuilt({ view, host: at, scroller });
    view.focus();
    paint.draw();

    // 開いた位置へ合わせる。字体や画像で高さが決まるまで数フレームかかる。
    let raf = 0;
    if (scroller && target) {
      let left = 8;
      const align = () => {
        const dom = view.nodeDOM(target.pos);
        const el = dom instanceof HTMLElement ? dom : null;
        if (el) {
          const delta =
            el.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top +
            (viewpoint?.into ?? 0);
          if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
        }
        if (--left > 0) raf = requestAnimationFrame(align);
      };
      align();
      raf = requestAnimationFrame(align);
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
        const hit = view.posAtCoords({ left: box.left + 8, top: box.top + 1 });
        const $at = hit
          ? view.state.doc.resolve(Math.min(hit.pos, view.state.doc.content.size))
          : null;
        const start = $at && $at.depth > 0 ? $at.before(1) : 0;
        const seen = blocks.find((b) => b.pos === start) ?? blocks[0];
        if (!seen) return;
        const dom = view.nodeDOM(seen.pos);
        const el = dom instanceof HTMLElement ? dom : null;
        const into = el ? Math.max(0, box.top - el.getBoundingClientRect().top) : 0;
        moved.current?.(prefix.length + seen.start, into);
      });
    };
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(tick);
      scroller?.removeEventListener("scroll", onScroll);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("visibilitychange", onLeave);
      // 片付ける前に書きかけを流す。ここで捨てると、ファイルを切り替えた
      // ときに打ったものが消える。
      send.flush();
      if (flushRef) flushRef.current = null;
      if (adoptRef) adoptRef.current = null;
      paint.stop();
      setBuilt(null);
      onDom?.(null);
      view.destroy();
    };
    // 本文を差し替えるのはファイルを開き直したときだけ。呼び出し側が key で作り直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* 編集面は ProseMirror が中の DOM を持つ。React の子は入れない。 */}
      <div ref={host} className="relative" />
      {built && (
        <TableGrips
          view={built.view}
          host={built.host}
          scroller={built.scroller}
        />
      )}
      {picking && (
        <IconBoard
          key={picking.seq}
          x={picking.x}
          y={picking.y}
          onPick={(value) => {
            picking.apply(value);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
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

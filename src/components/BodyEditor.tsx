import { EditorState, TextSelection } from "prosemirror-state";
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
import { toMarkdown } from "../lib/md/toMarkdown";
import { IconBoard } from "./CalloutIcon";
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
function caretPainter(view: EditorView, host: HTMLElement) {
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

  const draw = () => {
    const { selection } = view.state;
    if (!selection.empty || !view.hasFocus()) {
      hide();
      return;
    }
    // 隠れているところ（図だけを出している塊の中など）は測れない。
    let at: { left: number; top: number; bottom: number } | null = null;
    try {
      at = view.composing ? fromDom() : view.coordsAtPos(selection.head);
    } catch {
      at = null;
    }
    if (!at) {
      hide();
      return;
    }
    const box = host.getBoundingClientRect();
    const left = at.left - box.left;
    const top = at.top - box.top;
    const height = at.bottom - at.top;
    const now = `${left},${top},${height}`;
    if (now === was && shown) return;
    was = now;

    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.height = `${height}px`;
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

  // 棒は組み直しのときだけ描き直すのでは足りない。位置が変わる契機は他にもある。
  //
  // ただし測るとレイアウトが走るので、来た合図は 1 枚にまとめる。打鍵ごとに
  // 打鍵・選択の変化・大きさの変化の 3 経路から来るため、そのまま測ると
  // 同期レイアウトが何度も走って重くなる。
  let frame = 0;
  const again = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  };
  view.dom.addEventListener("focus", again);
  view.dom.addEventListener("blur", again);
  // コードの塊のように中で横スクロールするものがある。scroll は上がって
  // こないので捕まえる側で拾う。
  view.dom.addEventListener("scroll", again, true);
  // 組み直しを伴わない移動（⌘⌫ の既定動作など）はここで拾う。
  document.addEventListener("selectionchange", again);
  // 字体の読み込み・折り返し・塊の開閉で高さが変わったら測り直す。
  const watch = new ResizeObserver(again);
  watch.observe(view.dom);

  return {
    draw: again,
    stop: () => {
      view.dom.removeEventListener("focus", again);
      view.dom.removeEventListener("blur", again);
      view.dom.removeEventListener("scroll", again, true);
      document.removeEventListener("selectionchange", again);
      watch.disconnect();
      cancelAnimationFrame(frame);
      bar.remove();
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
        caret.draw();
      },
    });
    const caret = caretPainter(view, at);

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
      caret.draw();
    };
    if (adoptRef) adoptRef.current = adopt;
    // 窓を離れるときは待たずに流す。戻ってこないこともある。
    const onLeave = () => send.flush();
    window.addEventListener("blur", onLeave);
    document.addEventListener("visibilitychange", onLeave);

    onDom?.(view.dom);
    view.focus();
    caret.draw();

    const scroller = scrollerOf(at);
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
      caret.stop();
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

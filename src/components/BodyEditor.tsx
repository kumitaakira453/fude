import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
// ProseMirror が要る土台の指定。改行の前後に挟む見えない img を本文の img 指定から
// 守るもの（無いと typography の余白が付いて、改行のたびに隙間が空く）や、
// 選択の見せ方が入っている。
import "prosemirror-view/style/prosemirror.css";
import { useEffect, useRef, useState } from "react";
import { fromMarkdown, type Loaded } from "../lib/md/fromMarkdown";
import { nodeViews, type EditorDeps } from "../lib/md/nodeViews";
import { editorPlugins } from "../lib/md/plugins";
import { toMarkdown } from "../lib/md/toMarkdown";
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
// 標準のカーソルは、明朝のように上下へ余裕のある書体と広い行間が重なると、
// 字よりずっと大きく描かれる（ゴシックや行間を詰めたときは起きない）。高さを
// 決める指定は CSS に無いので、字の箱に合わせた棒を自分で重ねる。
// 変換中は標準のカーソルへ戻す。二重に見えるのと、変換の位置が遅れるのを防ぐ。
function caretPainter(view: EditorView, host: HTMLElement) {
  const bar = document.createElement("div");
  bar.className = "mg-caret";
  bar.style.display = "none";
  host.appendChild(bar);

  const draw = () => {
    const { selection } = view.state;
    if (!selection.empty || !view.hasFocus() || view.composing) {
      bar.style.display = "none";
      host.classList.remove("mg-caret-on");
      return;
    }
    const at = view.coordsAtPos(selection.head);
    const box = host.getBoundingClientRect();
    bar.style.display = "block";
    bar.style.left = `${at.left - box.left}px`;
    bar.style.top = `${at.top - box.top}px`;
    bar.style.height = `${at.bottom - at.top}px`;
    host.classList.add("mg-caret-on");
    // 打っている間は点滅を止める。動くたびに掛け直して数える。
    bar.classList.remove("is-idle");
    void bar.offsetWidth;
    bar.classList.add("is-idle");
  };

  const onFocus = () => draw();
  view.dom.addEventListener("focus", onFocus);
  view.dom.addEventListener("blur", onFocus);
  return {
    draw,
    stop: () => {
      view.dom.removeEventListener("focus", onFocus);
      view.dom.removeEventListener("blur", onFocus);
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
  onChange: (raw: string) => void;
  onSave: () => void;
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

    const loaded = fromMarkdown(body);
    const blocks = blocksOf(loaded);
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
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        caret.draw();
        if (tr.docChanged) changed.current(prefix + toMarkdown(next.doc, loaded));
      },
    });
    const caret = caretPainter(view, at);
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
    let tick = 0;
    const onScroll = () => {
      if (!scroller || !moved.current) return;
      cancelAnimationFrame(tick);
      tick = requestAnimationFrame(() => {
        const top = scroller.getBoundingClientRect().top;
        let into = 0;
        const seen = blocks.find((b) => {
          const dom = view.nodeDOM(b.pos);
          const el = dom instanceof HTMLElement ? dom : null;
          if (!el || el.getBoundingClientRect().bottom <= top) return false;
          into = Math.max(0, top - el.getBoundingClientRect().top);
          return true;
        });
        if (seen) moved.current?.(prefix.length + seen.start, into);
      });
    };
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(tick);
      scroller?.removeEventListener("scroll", onScroll);
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

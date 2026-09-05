import { baseKeymap } from "prosemirror-commands";
import { inputRules, undoInputRule } from "prosemirror-inputrules";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef } from "react";
import { fromMarkdown, type Loaded } from "../lib/md/fromMarkdown";
import { rules } from "../lib/md/inputRules";
import { schema } from "../lib/md/schema";
import { toMarkdown } from "../lib/md/toMarkdown";

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

export function BodyEditor({
  body,
  prefix,
  className,
  initialOffset,
  onOffset,
  onChange,
  onSave,
}: {
  body: string;
  // フロントマター。本文の前にそのまま戻す。
  prefix: string;
  className?: string;
  // 開いたときに合わせる位置（原文の先頭からの文字数）。
  initialOffset?: number;
  onOffset?: (offset: number) => void;
  onChange: (raw: string) => void;
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const changed = useRef(onChange);
  const saved = useRef(onSave);
  const moved = useRef(onOffset);
  changed.current = onChange;
  saved.current = onSave;
  moved.current = onOffset;

  useEffect(() => {
    const at = host.current;
    if (!at) return;

    const loaded = fromMarkdown(body);
    const blocks = blocksOf(loaded);
    const want = Math.max(0, (initialOffset ?? 0) - prefix.length);
    const target = want > 0 ? (blocks.find((b) => b.end > want) ?? null) : null;

    const item = schema.nodes.listItem;
    const state = EditorState.create({
      doc: loaded.doc,
      // 焦点を当てると選んでいるところへ画面が動く。合わせたい位置を先に選んでおく。
      selection: target
        ? TextSelection.near(loaded.doc.resolve(target.pos + 1))
        : undefined,
      plugins: [
        history(),
        inputRules({ rules }),
        keymap({
          // 変換した直後に打ち消せないと、記号そのものを書けなくなる。
          Backspace: undoInputRule,
          "Mod-s": () => {
            saved.current();
            return true;
          },
          "Mod-z": undo,
          "Shift-Mod-z": redo,
          "Mod-y": redo,
          Enter: splitListItem(item),
          Tab: sinkListItem(item),
          "Shift-Tab": liftListItem(item),
        }),
        keymap(baseKeymap),
      ],
    });

    const view = new EditorView(at, {
      state,
      attributes: { class: `mg-pm ${className ?? ""}`.trim() },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) changed.current(prefix + toMarkdown(next.doc, loaded));
      },
    });
    view.focus();

    const scroller = scrollerOf(at);
    // 開いた位置へ合わせる。字体や画像で高さが決まるまで数フレームかかる。
    let raf = 0;
    if (scroller && target) {
      let left = 8;
      const align = () => {
        const dom = view.nodeDOM(target.pos);
        const el = dom instanceof HTMLElement ? dom : null;
        if (el) {
          const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
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
        const seen = blocks.find((b) => {
          const dom = view.nodeDOM(b.pos);
          const el = dom instanceof HTMLElement ? dom : null;
          return el ? el.getBoundingClientRect().bottom > top : false;
        });
        if (seen) moved.current?.(prefix.length + seen.start);
      });
    };
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(tick);
      scroller?.removeEventListener("scroll", onScroll);
      view.destroy();
    };
    // 本文を差し替えるのはファイルを開き直したときだけ。呼び出し側が key で作り直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} />;
}

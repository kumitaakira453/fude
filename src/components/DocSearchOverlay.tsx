import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  docFindNonceAtom,
  docFindOpenAtom,
  highlightAtom,
  searchActiveHitAtom,
} from "../state/atoms";
import { clipRects, scrollBoxOf } from "../lib/domText";
import { buildMatcher } from "../lib/search";
import { Icon } from "./Icon";

interface RectBox {
  top: number;
  left: number;
  width: number;
  height: number;
}
interface Match {
  rects: RectBox[];
}

// 本文 DOM を書き換えず、検索ヒットを角丸の矩形として重ねるオーバーレイ。
// ヒット総数・次/前移動・アクティブ強調を提供する。
export function DocSearchOverlay({
  content,
  isActive,
  path,
  docKey,
}: {
  content: HTMLElement | null;
  isActive: boolean;
  path?: string;
  docKey?: string;
}) {
  const [highlight, setHighlight] = useAtom(highlightAtom);
  const activeHit = useAtomValue(searchActiveHitAtom);
  const docFindNonce = useAtomValue(docFindNonceAtom);
  const [matches, setMatches] = useState<Match[]>([]);
  const [active, setActive] = useState(0);
  const rangesRef = useRef<Range[]>([]);
  // ファイル内検索ウィジェット（⌘F）。open は共有（⌘⇧F 等で閉じられる）、q は入力値。
  const [open, setOpen] = useAtom(docFindOpenAtom);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 見つけた範囲を測って矩形にする。探し直しは伴わないので、枠の中を
  // スクロールしただけのときはこちらだけを呼ぶ。
  const measure = useCallback(
    (ranges: Range[]) => {
      if (!content) return;
      const base = content.getBoundingClientRect();
      // ピル感を出すため各矩形を少しだけ外側に広げる
      const PX = 3;
      const PY = 2;
      setMatches(
        ranges.map((r) => {
          const box = scrollBoxOf(r.startContainer);
          const padded = Array.from(r.getClientRects()).map(
            (rc) =>
              new DOMRect(
                rc.left - PX,
                rc.top - PY,
                rc.width + PX * 2,
                rc.height + PY * 2,
              ),
          );
          return {
            rects: clipRects(
              padded,
              box ? box.getBoundingClientRect() : null,
            ).map((rc) => ({
              top: rc.top - base.top,
              left: rc.left - base.left,
              width: rc.width,
              height: rc.height,
            })),
          };
        }),
      );
    },
    [content],
  );

  const compute = useCallback(() => {
    if (!content || !isActive || !highlight?.term) {
      rangesRef.current = [];
      setMatches([]);
      return;
    }
    // サイドバー検索と同じマッチャを使い、結果とハイライト位置を完全一致させる
    // （whole-word / 大小 / 正規表現の解釈を揃える）
    const re = buildMatcher(highlight.term, {
      caseSensitive: highlight.caseSensitive,
      useRegex: highlight.useRegex,
      wholeWord: highlight.wholeWord,
    });
    if (!re) {
      rangesRef.current = [];
      setMatches([]);
      return;
    }
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const pe = node.parentElement as HTMLElement | null;
      // 編集中の textarea 等は対象外
      if (pe?.closest?.(".mg-cell-editor")) continue;
      // Mermaid など SVG 内のテキストは対象外（図の再描画で矩形が不安定になる）
      if (pe?.closest?.("svg")) continue;
      const text = node.nodeValue ?? "";
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const len = m[0].length || 1;
        const r = new Range();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + len);
        ranges.push(r);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
    rangesRef.current = ranges;
    measure(ranges);
  }, [content, isActive, highlight, measure]);

  // 新しい検索語（nonce 変化）で先頭ヒットへ
  useLayoutEffect(() => {
    setActive(0);
  }, [highlight?.nonce]);

  // レイアウト確定後に矩形を計算。内容・幅・フォント変更やリサイズにも追従。
  useLayoutEffect(() => {
    compute();
    if (!content) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(content);
    window.addEventListener("resize", schedule);
    // 表やコードは枠の中で横にスクロールする。印は文字の上に重ねているだけで
    // 一緒には動かないので、枠が動いたら測り直す。scroll は上がって来ないが、
    // 捕まえる向き（capture）なら親でも受け取れる。
    let scrollRaf = 0;
    const onScroll = () => {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => measure(rangesRef.current));
    };
    content.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(scrollRaf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      content.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [compute, measure, content, docKey]);

  // 検索結果リストのナビゲーションから「このファイルの N 番目のヒットへ」の指定が来たら、
  // 描画済みヒットの該当インデックスをアクティブにする（範囲外はクランプ）。
  useLayoutEffect(() => {
    if (!isActive || !activeHit || activeHit.path !== path) return;
    if (!matches.length) return;
    setActive(Math.min(Math.max(activeHit.hitIndex, 0), matches.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHit, matches, path, isActive]);

  // アクティブなヒットを中央へスクロール
  const scrollToActive = useCallback(
    (idx: number) => {
      const r = rangesRef.current[idx];
      const el = r?.startContainer.parentElement;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [],
  );

  useLayoutEffect(() => {
    if (matches.length) scrollToActive(active);
    // active/検索/ナビの変化時に追従
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, highlight?.nonce, activeHit?.nonce]);

  const go = useCallback(
    (dir: 1 | -1) => {
      setActive((a) => {
        const n = matches.length;
        if (!n) return 0;
        return (a + dir + n) % n;
      });
    },
    [matches.length],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHighlight(null);
  }, [setHighlight]);

  // 外部（ディレクトリ検索のジャンプ等）でハイライト語が変わったら入力欄へ反映
  useEffect(() => {
    const t = highlight?.term ?? "";
    setQ((cur) => (cur === t ? cur : t));
  }, [highlight?.nonce]);

  // ⌘F: ウィジェットを開き入力欄へフォーカス＋全選択（プリフィルは highlight 経由）
  useEffect(() => {
    if (!isActive || docFindNonce === 0) return;
    setOpen(true);
    const raf = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [docFindNonce, isActive]);

  const onQChange = (v: string) => {
    setQ(v);
    setHighlight(
      v
        ? {
            term: v,
            caseSensitive: false,
            useRegex: false,
            wholeWord: false,
            nonce: Math.random(),
          }
        : null,
    );
  };

  // キーボード: Cmd/Ctrl+G 次、Shift で前、Esc で解除。
  // ⌘F ウィジェットが開いている時だけ有効（ディレクトリ検索時は無効）。
  useEffect(() => {
    if (!isActive || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        go(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        const ae = document.activeElement as HTMLElement | null;
        // find ウィジェット入力欄からの Esc はここで閉じる（他の入力欄は無視）
        if (ae && ae !== inputRef.current && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA"))
          return;
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, open, go, close]);

  if (!isActive || (!open && !highlight?.term)) return null;

  const total = matches.length;
  const layer =
    content &&
    createPortal(
      <div className="mg-hl-layer" aria-hidden>
        {matches.map((m, i) =>
          m.rects.map((rc, j) => (
            <div
              key={`${i}:${j}`}
              className={`mg-hl${i === active ? " mg-hl-active" : ""}`}
              style={{
                top: rc.top,
                left: rc.left,
                width: rc.width,
                height: rc.height,
              }}
            />
          )),
        )}
      </div>,
      content,
    );

  return (
    <>
      {layer}
      {/* find ウィジェットは ⌘F で開いた時だけ。ディレクトリ検索(⌘⇧F)では
         本文ハイライト（ピル）のみで、per-file の件数ウィジェットは出さない。 */}
      {open && (
      <div className="mg-find">
        <input
          ref={inputRef}
          className="mg-find-input"
          value={q}
          spellCheck={false}
          placeholder="ファイル内検索"
          onChange={(e) => onQChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <span className="mg-find-count">
          {q ? `${total ? active + 1 : 0} / ${total}` : ""}
        </span>
        <button
          className="mg-find-btn"
          title="前のヒット (⇧Enter / ⇧⌘G)"
          disabled={!total}
          onClick={() => go(-1)}
        >
          <Icon name="keyboard_arrow_up" size={18} />
        </button>
        <button
          className="mg-find-btn"
          title="次のヒット (Enter / ⌘G)"
          disabled={!total}
          onClick={() => go(1)}
        >
          <Icon name="keyboard_arrow_down" size={18} />
        </button>
        <button className="mg-find-btn" title="閉じる (Esc)" onClick={close}>
          <Icon name="close" size={18} />
        </button>
      </div>
      )}
    </>
  );
}

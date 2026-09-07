import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  docFindNonceAtom,
  docFindOpenAtom,
  highlightAtom,
  searchActiveHitAtom,
} from "../state/atoms";
import { clipRects, scrollBoxOf, SYNTHETIC } from "../lib/domText";
import { buildMatcher, stepHit, type HitStep } from "../lib/search";
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

// 本文が変わってから探し直すまでの待ち。編集で次々に変わるあいだは
// 走査をまとめる。
const RESCAN_WAIT = 150;

// 本文 DOM を書き換えず、検索ヒットを角丸の矩形として重ねるオーバーレイ。
// ヒット総数・次/前移動・アクティブ強調を提供する。
export function DocSearchOverlay({
  content,
  into,
  isActive,
  path,
  docKey,
}: {
  // 探す先。この中の文字ノードを走査する。
  content: HTMLElement | null;
  // 印を重ねる先と、矩形を測る基準。渡さなければ content と同じ。
  //
  // 編集面では別にする必要がある。本文の DOM は ProseMirror が持っていて、
  // その中に React の要素を入れると本文の書き換えと見なされて消される
  // （registerMirror が属性の mutation に節点の範囲を返す）。外側の
  // 入れ物へ重ねる。
  into?: HTMLElement | null;
  isActive: boolean;
  path?: string;
  docKey?: string;
}) {
  const [highlight, setHighlight] = useAtom(highlightAtom);
  const activeHit = useAtomValue(searchActiveHitAtom);
  const docFindNonce = useAtomValue(docFindNonceAtom);
  const [matches, setMatches] = useState<Match[]>([]);
  // 送り先と、送った回数。回数を一緒に持つのは、ヒットが 1 件だけのときに
  // 「次へ」で位置が変わらないため（search.ts の stepHit を参照）。
  const [step, setStep] = useState<HitStep>({ at: 0, went: 0 });
  const active = step.at;
  const rangesRef = useRef<Range[]>([]);
  // ファイル内検索ウィジェット（⌘F）。open は共有（⌘⇧F 等で閉じられる）、q は入力値。
  const [open, setOpen] = useAtom(docFindOpenAtom);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 見つけた範囲を測って矩形にする。探し直しは伴わないので、枠の中を
  // スクロールしただけのときはこちらだけを呼ぶ。
  const layerAt = into ?? content;

  const measure = useCallback(
    (ranges: Range[]) => {
      if (!content || !layerAt) return;
      const base = layerAt.getBoundingClientRect();
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
    [content, layerAt],
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
      // 画面には出るがソースには無い文字は対象外。アイコンは合字なので、
      // 除かないと "drag" で drag_indicator が当たる。図（svg）は再描画で
      // 矩形が不安定になるのでこれにも入っている。
      if (node.parentElement?.closest(SYNTHETIC)) continue;
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
    setStep({ at: 0, went: 0 });
  }, [highlight?.nonce]);

  // レイアウト確定後に矩形を計算。内容・幅・フォント変更やリサイズにも追従。
  useLayoutEffect(() => {
    compute();
    if (!content) return;
    // 高さや幅が変わっただけなら測り直すだけ。本文を探し直すと、ヒットの数だけ
    // 矩形を測る走査が、エディタの開閉やブロックの削除に乗ってしまう。
    let raf = 0;
    const remeasure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => measure(rangesRef.current));
    };
    const ro = new ResizeObserver(remeasure);
    ro.observe(content);
    window.addEventListener("resize", remeasure);
    // 本文の作りが変わったときだけ探し直す。まとめて 1 回にする。
    let rescan = 0;
    const scheduleScan = () => {
      window.clearTimeout(rescan);
      rescan = window.setTimeout(compute, RESCAN_WAIT);
    };
    const mo = new MutationObserver(scheduleScan);
    mo.observe(content, { childList: true, subtree: true, characterData: true });
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
      window.clearTimeout(rescan);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", remeasure);
      content.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [compute, measure, content, docKey]);

  // 検索結果リストのナビゲーションから「このファイルの N 番目のヒットへ」の指定が来たら、
  // 描画済みヒットの該当インデックスをアクティブにする（範囲外はクランプ）。
  useLayoutEffect(() => {
    if (!isActive || !activeHit || activeHit.path !== path) return;
    if (!matches.length) return;
    // 行き先が同じなら控えを差し替えない。測り直しでこの効果が走るたびに
    // 差し替えると、追従 → スクロール → 測り直しで回り続ける。
    // 同じ場所へもう一度送るのは一覧側の合図（activeHit.nonce）が担う。
    setStep((now) => {
      const at = Math.min(Math.max(activeHit.hitIndex, 0), matches.length - 1);
      return now.at === at ? now : { at, went: now.went + 1 };
    });
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
    if (matches.length) scrollToActive(step.at);
    // 送るたびに追従させる。位置だけを見ると、ヒットが 1 件のときに動かない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, highlight?.nonce, activeHit?.nonce]);

  const go = useCallback(
    (dir: 1 | -1) => {
      setStep((now) => stepHit(now, dir, matches.length));
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
    layerAt &&
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
      layerAt,
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

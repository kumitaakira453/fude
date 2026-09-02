import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { headOf, type Resolution } from "../../lib/blockDiff";
import { blockRect, readBlockText, rangeAt } from "../../lib/domText";
import { findPlain } from "../../lib/projection";
import { answeredByAgent, type AnchorHit, type ReviewThread } from "../../lib/review";
import { Icon } from "../Icon";

// 指摘が付いている箇所に印を重ねる。DOM は書き換えず、矩形を絶対配置で
// 載せるだけなので本文の組版に影響しない。
//
// 位置は「基準版のブロック → 対応付け → 現在のブロック」で決める。現在の本文から
// 引用文字列を探すと、指摘に応えて本文が書き換えられた瞬間に位置を失う。

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Mark {
  id: string;
  moved: boolean; // 対象が書き換わっている
  guess: boolean; // 位置が特定できず、近いブロックに出している
  // ブロック全体の外枠。どのブロックへの指摘かを示す。
  area: Rect | null;
  // 指摘した箇所そのもの。書き換わっていても見つかれば出す。
  spots: Rect[];
  hit: AnchorHit;
  // ホバーで出す指摘の中身（1 件目の書き込みと、続きの件数）。
  note: string;
  more: number;
  who: string;
  at: number;
  // 最後の書き込みがエージェント。返事が返ってきていることを示す。
  answered: boolean;
}

// 同じ行に並ぶ細切れの矩形を 1 本に畳む。文字ノードの切れ目でばらばらに
// 出ると継ぎ目が見えてしまう。表のセルの間（広く空く）は畳まない。
const GAP = 6;

function mergeRects(rects: DOMRect[]): DOMRect[] {
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const out: DOMRect[] = [];
  for (const rc of sorted) {
    const last = out[out.length - 1];
    const sameLine =
      last &&
      Math.abs(last.top - rc.top) < 2 &&
      Math.abs(last.height - rc.height) < 2;
    if (sameLine && rc.left - last.right <= GAP) {
      out[out.length - 1] = new DOMRect(
        last.left,
        last.top,
        Math.max(last.right, rc.right) - last.left,
        Math.max(last.height, rc.height),
      );
      continue;
    }
    out.push(rc);
  }
  return out;
}

// 位置が特定できない指摘の行き先。引用の一部を含むブロックを画面から探す。
// 何も出さないと、本文を書き換えたとたんに指摘そのものが消えたように見える。
const PROBE = 40;
const PROBE_MIN = 6;

function guessBlock(
  content: HTMLElement,
  ...needles: string[]
): HTMLElement | null {
  for (const needle of needles) {
    const probe = needle.replace(/\s+/g, "").slice(0, PROBE);
    if (probe.length < PROBE_MIN) continue;
    for (const el of content.querySelectorAll<HTMLElement>("[data-mg-block]")) {
      if ((el.textContent ?? "").replace(/\s+/g, "").includes(probe)) return el;
    }
  }
  return null;
}

// 印を離れてからカードを閉じるまでの猶予。印とカードの間を指が渡れる長さ。
const HOVER_GRACE = 160;

// 指摘が付いてからの経過。細かい数字は要らないので桁が分かる粒度で出す。
function ago(at: number): string {
  const min = (Date.now() - at) / 60000;
  if (min < 1) return "たった今";
  if (min < 60) return `${Math.floor(min)} 分前`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} 時間前`;
  const day = Math.floor(min / 60 / 24);
  return day < 30 ? `${day} 日前` : `${Math.floor(day / 30)} か月前`;
}

// セルの文字を丸ごと覆っている指摘は、文字の行ではなくセルの箱で示す。
// 表の中では、そのほうがどこへの指摘か読み取りやすい。
function cellOf(range: Range): Element | null {
  const start = range.startContainer.parentElement?.closest("td,th");
  const end = range.endContainer.parentElement?.closest("td,th");
  if (!start || start !== end) return null;
  const full = (start.textContent ?? "").trim();
  const text = range.toString().trim();
  return full.length > 0 && text === full ? start : null;
}

// 横に溢れる表は枠の中でスクロールする。印も見えている範囲で切る。
function clipTo(rects: DOMRect[], clip: DOMRect | null): DOMRect[] {
  if (!clip) return rects;
  const out: DOMRect[] = [];
  for (const rc of rects) {
    const left = Math.max(rc.left, clip.left);
    const right = Math.min(rc.right, clip.right);
    const top = Math.max(rc.top, clip.top);
    const bottom = Math.min(rc.bottom, clip.bottom);
    if (right - left > 1 && bottom - top > 1) {
      out.push(new DOMRect(left, top, right - left, bottom - top));
    }
  }
  return out;
}

export function AnchorOverlay({
  content,
  threads,
  resolutions,
  contentKey,
  draft,
  onPick,
}: {
  content: HTMLElement | null;
  threads: ReviewThread[];
  resolutions: Map<string, Resolution>;
  contentKey: string;
  // 書いている最中の指摘。どこへの指摘かが分かるように印を出す。
  draft?: {
    blockIndex: number;
    offset: number;
    length: number;
    whole?: boolean;
  } | null;
  onPick: (hit: AnchorHit) => void;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [pending, setPending] = useState<Rect[]>([]);
  // ホバーで出す指摘の中身。開くまでもなく読めるようにする。
  const [peek, setPeek] = useState<{
    id: string;
    top: number;
    left: number;
    note: string;
    more: number;
    state: string;
    who: string;
    at: number;
    answered: boolean;
    hit: AnchorHit;
  } | null>(null);
  // 印からカードへ指を移す間、少しだけ開いたままにする。印を離れた瞬間に
  // 消すと、カードに触れないので押せない。
  const hideTimer = useRef<number | undefined>(undefined);
  const keep = useCallback(() => window.clearTimeout(hideTimer.current), []);
  const hideSoon = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setPeek(null), HOVER_GRACE);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const compute = useCallback(() => {
    if (!content) {
      setMarks([]);
      setPending([]);
      return;
    }
    // 指摘が 1 件も無くても、書いている最中の印は出す。
    const base = content.getBoundingClientRect();
    const next: Mark[] = [];

    for (const thread of threads) {
      const resolution = resolutions.get(thread.id);
      if (!resolution) continue;
      const head = headOf(resolution);
      const placed = head
        ? content.querySelector<HTMLElement>(`[data-mg-block="${head.index}"]`)
        : null;
      // 特定できないものは、引用を含むブロックへ寄せて出す（点線で区別する）。
      const el = placed ?? guessBlock(content, thread.selection, thread.quote);
      if (!el) continue; // 漸進描画でまだ出ていない / 手がかりが無い
      const guess = placed === null;

      const bt = readBlockText(el);
      // 書き換わっていても、指摘した文字列が残っていれば場所は出せる。
      // 見つかった箇所は塗り、ブロック全体は枠で示す（2 段で見せる）。
      const span = thread.selection
        ? findPlain(bt.plain, thread.selection, thread.selection_offset)
        : null;
      const whole = rangeAt(bt, 0, bt.plain.length);
      if (!whole) continue;
      const inner = span ? rangeAt(bt, span.start, span.end) : null;

      const wrap = el.querySelector(".mg-table-wrap");
      const clip = wrap ? wrap.getBoundingClientRect() : null;
      // ブロック全体の印は箱で測る。文字の範囲だと、コールアウトのように
      // 内側に余白を持つブロックで枠より内側に縮む。
      const boxed = blockRect(el) ?? whole.getBoundingClientRect();
      const areas = clipTo([boxed], clip);
      const cell = inner ? cellOf(inner) : null;
      const spots = inner
        ? clipTo(
            cell
              ? [cell.getBoundingClientRect()]
              : mergeRects(Array.from(inner.getClientRects())),
            clip,
          )
        : [];
      // 箇所が特定できているうちは、外枠は書き換わったときだけ添える。
      // いつも二重に出すと、どこへの指摘か読み取りにくい。
      const moved = guess || resolution.state === "rewritten";
      const area = spots.length === 0 || moved ? (areas[0] ?? null) : null;
      if (!area && spots.length === 0) continue;

      const rel = (rc: DOMRect): Rect => ({
        top: rc.top - base.top,
        left: rc.left - base.left,
        width: rc.width,
        height: rc.height,
      });
      const anchor = spots[0] ?? areas[0];
      const last = spots[spots.length - 1] ?? areas[0];
      const first = thread.comments[0];
      next.push({
        id: thread.id,
        moved,
        guess,
        area: area ? rel(area) : null,
        spots: spots.map(rel),
        note: first ? first.body : "",
        more: Math.max(0, thread.comments.length - 1),
        who: first ? first.author : "",
        at: first ? first.created_at : 0,
        answered: answeredByAgent(thread),
        hit: {
          id: thread.id,
          top: anchor.top,
          bottom: last.bottom,
          left: anchor.left,
        },
      });
    }
    setMarks(next);

    // 書いている最中の対象。押せる印にはしない（本文の上を塞がない）。
    if (!draft) {
      setPending([]);
      return;
    }
    const el = content.querySelector<HTMLElement>(
      `[data-mg-block="${draft.blockIndex}"]`,
    );
    if (!el) {
      setPending([]);
      return;
    }
    const bt = readBlockText(el);
    const range = draft.whole
      ? null
      : rangeAt(bt, draft.offset, draft.offset + draft.length);
    if (!draft.whole && !range) {
      setPending([]);
      return;
    }
    const wrap = el.querySelector(".mg-table-wrap");
    const clip = wrap ? wrap.getBoundingClientRect() : null;
    const cell = range ? cellOf(range) : null;
    const boxed = draft.whole ? blockRect(el) : null;
    const rects = clipTo(
      boxed
        ? [boxed]
        : cell
          ? [cell.getBoundingClientRect()]
          : range
            ? mergeRects(Array.from(range.getClientRects()))
            : [],
      clip,
    );
    setPending(
      rects.map((rc) => ({
        top: rc.top - base.top,
        left: rc.left - base.left,
        width: rc.width,
        height: rc.height,
      })),
    );
  }, [content, threads, resolutions, draft]);

  // 漸進描画で後から出るブロックにも追従する。
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
    const mo = new MutationObserver(schedule);
    mo.observe(content, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [compute, content, contentKey]);

  if (!content || (marks.length === 0 && pending.length === 0)) return null;

  return createPortal(
    <div className="mg-review-layer not-prose">
      {pending.map((rc, i) => (
        <div key={`d:${i}`} className="mg-review-draft" style={rc} />
      ))}
      {marks.map((mark) => {
        const peekAt = (rc: Rect) => () => {
          keep();
          setPeek({
            id: mark.id,
            top: rc.top + rc.height,
            left: rc.left,
            note: mark.note,
            more: mark.more,
            who: mark.who,
            at: mark.at,
            answered: mark.answered,
            hit: mark.hit,
            state: mark.guess
              ? "元の箇所が見つかりません。近いブロックに出しています"
              : mark.moved
                ? "指摘のあと本文が書き換わっています"
                : "",
          });
        };
        return (
          <Fragment key={mark.id}>
            {mark.area && (
              <button
                type="button"
                onClick={() => onPick(mark.hit)}
                onMouseEnter={peekAt(mark.area)}
                onMouseLeave={hideSoon}
                className={`mg-review-mark mg-review-mark-area${
                  mark.moved ? " mg-review-mark-moved" : ""
                }`}
                style={mark.area}
              />
            )}
            {mark.spots.map((rc, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onPick(mark.hit)}
                onMouseEnter={peekAt(rc)}
                onMouseLeave={hideSoon}
                className="mg-review-mark"
                style={rc}
              />
            ))}
          </Fragment>
        );
      })}
      {peek && (
        <div
          className="mg-review-peek"
          role="button"
          tabIndex={0}
          style={{ top: peek.top + 6, left: peek.left }}
          onMouseEnter={keep}
          onMouseLeave={hideSoon}
          onClick={() => onPick(peek.hit)}
          onKeyDown={(e) => e.key === "Enter" && onPick(peek.hit)}
        >
          <div className="mg-peek-top">
            <span className="mg-peek-face">
              <Icon name="format_quote" size={12} fill />
            </span>
            <span className="mg-peek-who">{peek.who || "指摘"}</span>
            {peek.at > 0 && <span className="mg-peek-when">{ago(peek.at)}</span>}
          </div>
          <div className="mg-review-peek-body">
            {peek.note || "（本文なし）"}
          </div>
          <div className="mg-peek-foot">
            {peek.answered && (
              <span className="mg-peek-chip is-answered">
                <Icon name="auto_awesome" size={11} fill />
                返信あり
              </span>
            )}
            {peek.more > 0 && (
              <span className="mg-peek-chip">
                <Icon name="forum" size={11} />
                {peek.more}
              </span>
            )}
            {peek.state && (
              <span className="mg-peek-chip is-note">
                <Icon name="history" size={11} />
                {peek.state}
              </span>
            )}
            <span className="mg-peek-go">クリックで開く</span>
          </div>
        </div>
      )}
    </div>,
    content,
  );
}

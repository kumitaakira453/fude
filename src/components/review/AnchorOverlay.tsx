import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { headOf, quoteBlocks, type Resolution } from "../../lib/blockDiff";
import {
  blockRect,
  clipRects,
  rangeAt,
  readBlockText,
  scrollBoxOf,
} from "../../lib/domText";
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
  // ブロック全体の外枠。どのブロックへの指摘かを示す。またいだ指摘では
  // 覆っているブロックの数だけ並ぶ。
  areas: Rect[];
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
const GAP = 8;

// 同じ行に載っているか。`コード` や数式の囲みは上端も高さも本文と揃わないので、
// 一致で見ると同じ行が別の行として残り、印が細切れになる。上下の重なりで見る。
function sameLine(a: { top: number; bottom: number }, b: DOMRect): boolean {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return overlap > Math.min(a.bottom - a.top, b.height) * 0.5;
}

function mergeRects(rects: DOMRect[]): DOMRect[] {
  // まず行に分ける。左右の並び替えは行ごとに行う（先に上端で並べると、
  // 囲みの分だけずれた矩形が行をまたいで前後する）。
  const lines: { top: number; bottom: number; parts: DOMRect[] }[] = [];
  for (const rc of [...rects].sort((a, b) => a.top - b.top)) {
    const line = lines[lines.length - 1];
    if (line && sameLine(line, rc)) {
      line.parts.push(rc);
      line.top = Math.min(line.top, rc.top);
      line.bottom = Math.max(line.bottom, rc.bottom);
      continue;
    }
    lines.push({ top: rc.top, bottom: rc.bottom, parts: [rc] });
  }

  const out: DOMRect[] = [];
  for (const line of lines) {
    let cur: DOMRect | null = null;
    for (const rc of line.parts.sort((a, b) => a.left - b.left)) {
      if (cur && rc.left - cur.right <= GAP) {
        const top = Math.min(cur.top, rc.top);
        const bottom = Math.max(cur.bottom, rc.bottom);
        cur = new DOMRect(
          cur.left,
          top,
          Math.max(cur.right, rc.right) - cur.left,
          bottom - top,
        );
        continue;
      }
      if (cur) out.push(cur);
      cur = rc;
    }
    if (cur) out.push(cur);
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

// カードと印の間、カードと画面の端の間に置く余白。
const PEEK_GAP = 6;
const PEEK_EDGE = 8;

// 本文を縦にスクロールしている枠。カードを見える範囲に収めるために使う。
function viewportOf(el: HTMLElement): { top: number; bottom: number } {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll") {
      const rc = node.getBoundingClientRect();
      return { top: rc.top, bottom: rc.bottom };
    }
    node = node.parentElement;
  }
  return { top: 0, bottom: window.innerHeight };
}

// 重ねた矩形の中に居るか。位置は本文の左上からの座標で持っている。
function inside(rc: Rect, x: number, y: number): boolean {
  return (
    x >= rc.left &&
    x <= rc.left + rc.width &&
    y >= rc.top &&
    y <= rc.top + rc.height
  );
}

// 指摘が付いてからの経過。細かい数字は要らないので桁が分かる粒度で出す。
function ago(at: number): string {
  const min = (Date.now() - at) / 60000;
  if (min < 1) return "たった今";
  if (min < 60) return `${Math.floor(min)} 分前`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} 時間前`;
  const day = Math.floor(min / 60 / 24);
  return day < 30 ? `${day} 日前` : `${Math.floor(day / 30)} か月前`;
}

// セルや箇条書きの項目の文字を丸ごと覆っている指摘は、文字の行ではなく
// その箱で示す。行ごとの矩形だと、`コード` の囲みやチェックの前後で切れて
// 散らかって見える。
const UNIT = "td,th,li[data-mg-item]";

function unitOf(range: Range): Element | null {
  const start = range.startContainer.parentElement?.closest(UNIT);
  const end = range.endContainer.parentElement?.closest(UNIT);
  if (!start || start !== end) return null;
  // 比べるのは画面に出る文字。チェックのアイコンは文字として数えない。
  const full = readBlockText(start as HTMLElement).plain.trim();
  const text = range.toString().trim();
  return full.length > 0 && text === full ? start : null;
}

export function AnchorOverlay({
  content,
  threads,
  resolutions,
  contentKey,
  draft,
  onPick,
  onRemove,
  onResolve,
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
    // ブロックをまたいで選んでいるときの、最後のブロックの番号。
    until?: number;
    // セル・項目を丸ごと対象にしたときの引き先（目印の CSS 選択子）。
    unit?: string;
  } | null;
  onPick: (hit: AnchorHit) => void;
  // 指摘そのものを取り消す。付け間違いを本文の上から消せるようにする。
  onRemove: (id: string) => void;
  // 解決にする。レビュー画面まで行かずに片付けられるようにする。
  onResolve: (id: string) => void;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [pending, setPending] = useState<Rect[]>([]);
  // ホバーで出す指摘の中身。開くまでもなく読めるようにする。
  const [peek, setPeek] = useState<{
    id: string;
    // 印の下端（既定の出し先）と上端（上に逃がすときの基準）。
    top: number;
    markTop: number;
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
  const cardRef = useRef<HTMLDivElement | null>(null);
  // 当たり判定と開き直しの判断を、描画のたびに作り直さずに済ませる控え。
  const marksRef = useRef<Mark[]>([]);
  const peekRef = useRef<string | null>(null);
  const keep = useCallback(() => window.clearTimeout(hideTimer.current), []);
  const hideSoon = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setPeek(null), HOVER_GRACE);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  // 印に何を出すか。矩形は位置を決めるためだけに受け取る。
  const showPeek = useCallback((mark: Mark, rc: Rect) => {
    peekRef.current = mark.id;
    setPeek({
      id: mark.id,
      top: rc.top + rc.height,
      markTop: rc.top,
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
  }, []);

  // 印は本文の上に重ねた飾りで、押せる箱にはしない（箱にすると、その上から
  // 文字を選べず、クリックもすべて指摘へ吸われる）。ホバーは重ねた矩形との
  // 当たり判定で見る。
  const hitAt = useCallback(
    (x: number, y: number): { mark: Mark; rc: Rect } | null => {
      for (const mark of marksRef.current) {
        // 箇所の印を先に見る。ブロック全体の枠より内側にあり、そちらの方が
        // どの指摘か絞れている。
        for (const rc of mark.spots) if (inside(rc, x, y)) return { mark, rc };
      }
      for (const mark of marksRef.current) {
        for (const rc of mark.areas) if (inside(rc, x, y)) return { mark, rc };
      }
      return null;
    },
    [],
  );

  useEffect(() => {
    if (!content) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      // 選択を引いているあいだは出さない。カードが下に出ると、ドラッグの
      // 行き先をそれが奪って選択が飛ぶ。
      if (e.buttons !== 0) {
        keep();
        if (peekRef.current) setPeek(null);
        return;
      }
      // カードの上ではカードの都合を優先する（触れているあいだは閉じない）。
      if ((e.target as Element | null)?.closest?.(".mg-review-peek")) {
        keep();
        return;
      }
      const x = e.clientX;
      const y = e.clientY;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const base = content.getBoundingClientRect();
        const found = hitAt(x - base.left, y - base.top);
        if (!found) {
          if (peekRef.current) hideSoon();
          return;
        }
        keep();
        if (peekRef.current !== found.mark.id) showPeek(found.mark, found.rc);
      });
    };
    const onLeave = () => hideSoon();
    content.addEventListener("mousemove", onMove);
    content.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      content.removeEventListener("mousemove", onMove);
      content.removeEventListener("mouseleave", onLeave);
    };
  }, [content, hitAt, keep, hideSoon, showPeek]);

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
      // またいだ指摘は引用に複数のブロックが入っている。箇所の線ではなく、
      // 覆っているブロックの枠で示す。
      const covered = quoteBlocks(thread.quote).length;
      // 書き換わっていても、指摘した文字列が残っていれば場所は出せる。
      // 見つかった箇所は塗り、ブロック全体は枠で示す（2 段で見せる）。
      const span =
        covered > 1 || !thread.selection
          ? null
          : findPlain(bt.plain, thread.selection, thread.selection_offset);
      const whole = rangeAt(bt, 0, bt.plain.length);
      if (!whole) continue;
      const inner = span ? rangeAt(bt, span.start, span.end) : null;

      const wrap = el.querySelector(".mg-table-wrap");
      const clip = wrap ? wrap.getBoundingClientRect() : null;
      // 箇所の印は、その文字が入っている枠で切る（表だけでなくコードや数式も
      // 枠の中で横にスクロールする）。
      const inBox = inner ? scrollBoxOf(inner.startContainer) : null;
      const spotClip = inBox ? inBox.getBoundingClientRect() : clip;
      // ブロック全体の印は箱で測る。文字の範囲だと、コールアウトのように
      // 内側に余白を持つブロックで枠より内側に縮む。
      const boxes: DOMRect[] = [];
      for (let i = 0; i < covered; i++) {
        const part =
          i === 0
            ? el
            : content.querySelector<HTMLElement>(
                `[data-mg-block="${(head?.index ?? -1) + i}"]`,
              );
        const box = part ? blockRect(part) : null;
        if (box) boxes.push(box);
      }
      if (boxes.length === 0) {
        const fallback = blockRect(el) ?? whole.getBoundingClientRect();
        boxes.push(fallback);
      }
      const areas = clipRects(boxes, clip);
      const cell = inner ? unitOf(inner) : null;
      const spots = inner
        ? clipRects(
            cell
              ? [cell.getBoundingClientRect()]
              : mergeRects(Array.from(inner.getClientRects())),
            spotClip,
          )
        : [];
      // 箇所が特定できているうちは、外枠は書き換わったときだけ添える。
      // いつも二重に出すと、どこへの指摘か読み取りにくい。
      const moved = guess || resolution.state === "rewritten";
      const shown = spots.length === 0 || moved ? areas : [];
      if (shown.length === 0 && spots.length === 0) continue;

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
        areas: shown.map(rel),
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
    // 丸ごとの対象は目印で直に引く。文字の一致で見分けると、記法の囲みや
    // チェックの前後で当たらないことがある。
    const marked = draft.unit ? el.querySelector(draft.unit) : null;
    const cell = marked ?? (range ? unitOf(range) : null);
    // またいで選んでいるときは、覆っているブロックの枠を並べる。
    const boxes: DOMRect[] = [];
    if (draft.whole) {
      const until = Math.max(draft.until ?? draft.blockIndex, draft.blockIndex);
      for (let i = draft.blockIndex; i <= until; i++) {
        const part =
          i === draft.blockIndex
            ? el
            : content.querySelector<HTMLElement>(`[data-mg-block="${i}"]`);
        const box = part ? blockRect(part) : null;
        if (box) boxes.push(box);
      }
    }
    const inBox = range ? scrollBoxOf(range.startContainer) : null;
    const rects = clipRects(
      boxes.length > 0
        ? boxes
        : cell
          ? [cell.getBoundingClientRect()]
          : range
            ? mergeRects(Array.from(range.getClientRects()))
            : [],
      boxes.length > 0 ? clip : inBox ? inBox.getBoundingClientRect() : clip,
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
    // 表やコードは枠の中で横にスクロールする。印は重ねているだけなので、
    // 枠が動いたら測り直す。scroll は上がって来ないが、捕まえる向き
    // （capture）なら親でも受け取れる。
    content.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      content.removeEventListener("scroll", schedule, { capture: true });
    };
  }, [compute, content, contentKey]);

  // カードは既定で印の下に出す。そこが見えていないときだけ上へ逃がし、
  // 上も入らなければ見える下端ぎりぎりに置く。下に出したまま画面外へ
  // 追い出すと、読むためにいちばん下までスクロールすることになる。
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !peek || !content) return;
    const place = () => {
      card.style.top = `${peek.top + PEEK_GAP}px`;
      const view = viewportOf(content);
      const box = card.getBoundingClientRect();
      if (box.bottom <= view.bottom - PEEK_EDGE) return;
      const base = content.getBoundingClientRect().top;
      const above = peek.markTop - box.height - PEEK_GAP;
      card.style.top =
        base + above >= view.top + PEEK_EDGE
          ? `${above}px`
          : `${view.bottom - PEEK_EDGE - box.height - base}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, { capture: true });
    };
  }, [peek, content]);

  marksRef.current = marks;
  if (peekRef.current !== (peek?.id ?? null)) peekRef.current = peek?.id ?? null;

  if (!content || (marks.length === 0 && pending.length === 0)) return null;

  return createPortal(
    <div className="mg-review-layer not-prose">
      {pending.map((rc, i) => (
        <div key={`d:${i}`} className="mg-review-draft" style={rc} />
      ))}
      {marks.map((mark) => {
        const hot = peek?.id === mark.id ? " mg-review-mark-active" : "";
        return (
          <Fragment key={mark.id}>
            {mark.areas.map((rc, i) => (
              <div
                key={`a:${i}`}
                className={`mg-review-mark mg-review-mark-area${
                  mark.moved ? " mg-review-mark-moved" : ""
                }${hot}`}
                style={rc}
              />
            ))}
            {mark.spots.map((rc, i) => (
              <div key={i} className={`mg-review-mark${hot}`} style={rc} />
            ))}
          </Fragment>
        );
      })}
      {peek && (
        <div
          ref={cardRef}
          className="mg-review-peek"
          role="button"
          tabIndex={0}
          style={{ top: peek.top + PEEK_GAP, left: peek.left }}
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
            {/* 解決と取り消しはカードの中から。カード自体は開く操作なので、
                ここでは伝播を止める。 */}
            <button
              type="button"
              className="mg-peek-done"
              title="この指摘を解決にする"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setPeek(null);
                onResolve(peek.hit.id);
              }}
            >
              <Icon name="check" size={13} />
            </button>
            <button
              type="button"
              className="mg-peek-drop"
              title="この指摘を削除"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setPeek(null);
                onRemove(peek.hit.id);
              }}
            >
              <Icon name="delete" size={13} />
            </button>
          </div>
        </div>
      )}
    </div>,
    content,
  );
}

import { headOf, quoteBlocks, type Resolution } from "./blockDiff";
import {
  blockRect,
  clipRects,
  rangeAt,
  readBlockText,
  scrollBoxOf,
} from "./domText";
import { findPlain } from "./projection";
import { answeredByAgent, type AnchorHit, type ReviewThread } from "./review";

// 指摘の印を、本文の上に重ねる矩形として組む。
//
// 位置は「基準版のブロック → 対応付け → 現在のブロック」で決める。現在の本文から
// 引用文字列を探すと、指摘に応えて本文が書き換えられた瞬間に位置を失う。
//
// 組むのはここ、出すのは AnchorOverlay。読むときと編集面で同じ見た目・同じ
// ホバーのカードを使うので、矩形の作り方だけを画面ごとに差し替える。

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Mark {
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

// 何を出すか。画面ごとに矩形の作り方が違うので、出す側はこれだけを受け取る。
export interface Marked {
  marks: Mark[];
  // 書いている最中の対象。押せる印にはしない。
  pending: Rect[];
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

export function mergeRects(rects: DOMRect[]): DOMRect[] {
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

// 重ねる先の左上を原点にした矩形へ直す。
export function relTo(base: DOMRect, rc: DOMRect): Rect {
  return {
    top: rc.top - base.top,
    left: rc.left - base.left,
    width: rc.width,
    height: rc.height,
  };
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

// セルや箇条書きの項目の文字を丸ごと覆っている指摘は、文字の行ではなく
// その箱で示す。行ごとの矩形だと、`コード` の囲みやチェックの前後で切れて
// 散らかって見える。
const UNIT = "td,th,li[data-mg-item]";

export function unitOf(range: Range): Element | null {
  const start = range.startContainer.parentElement?.closest(UNIT);
  const end = range.endContainer.parentElement?.closest(UNIT);
  if (!start || start !== end) return null;
  // 比べるのは画面に出る文字。チェックのアイコンは文字として数えない。
  const full = readBlockText(start as HTMLElement).plain.trim();
  const text = range.toString().trim();
  return full.length > 0 && text === full ? start : null;
}

// 指摘の中身をカードに出すための取り出し。矩形の作り方が違っても同じ。
export function noteOf(
  thread: ReviewThread,
): Pick<Mark, "note" | "more" | "who" | "at" | "answered"> {
  const first = thread.comments[0];
  return {
    note: first ? first.body : "",
    more: Math.max(0, thread.comments.length - 1),
    who: first ? first.author : "",
    at: first ? first.created_at : 0,
    answered: answeredByAgent(thread),
  };
}

// 書いている最中の指摘。どこへの指摘かが分かるように印を出す。
export interface DraftSpot {
  blockIndex: number;
  offset: number;
  length: number;
  whole?: boolean;
  // ブロックをまたいで選んでいるときの、最後のブロックの番号。
  until?: number;
  // セル・項目を丸ごと対象にしたときの引き先（目印の CSS 選択子）。
  unit?: string;
}

// 読むときの印。ブロックは目印（data-mg-block）で引く。
export function readingMarks(
  content: HTMLElement,
  base: DOMRect,
  threads: ReviewThread[],
  resolutions: Map<string, Resolution>,
): Mark[] {
  const out: Mark[] = [];
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
    const inner = span ? rangeAt(bt, span.start, span.end) : null;
    // 図のように選べる文字を持たないブロックは範囲を作れない。枠で示す。
    const outline = blockRect(el) ?? whole?.getBoundingClientRect() ?? null;
    if (!outline) continue;

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
    if (boxes.length === 0) boxes.push(outline);
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

    const anchor = spots[0] ?? areas[0];
    const last = spots[spots.length - 1] ?? areas[0];
    out.push({
      id: thread.id,
      moved,
      guess,
      areas: shown.map((rc) => relTo(base, rc)),
      spots: spots.map((rc) => relTo(base, rc)),
      ...noteOf(thread),
      hit: {
        id: thread.id,
        top: anchor.top,
        bottom: last.bottom,
        left: anchor.left,
      },
    });
  }
  return out;
}

// 読むときの、書いている最中の対象。
export function readingPending(
  content: HTMLElement,
  base: DOMRect,
  draft: DraftSpot,
): Rect[] {
  const el = content.querySelector<HTMLElement>(
    `[data-mg-block="${draft.blockIndex}"]`,
  );
  if (!el) return [];
  const bt = readBlockText(el);
  const range = draft.whole
    ? null
    : rangeAt(bt, draft.offset, draft.offset + draft.length);
  if (!draft.whole && !range) return [];

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
  return clipRects(
    boxes.length > 0
      ? boxes
      : cell
        ? [cell.getBoundingClientRect()]
        : range
          ? mergeRects(Array.from(range.getClientRects()))
          : [],
    boxes.length > 0 ? clip : inBox ? inBox.getBoundingClientRect() : clip,
  ).map((rc) => relTo(base, rc));
}

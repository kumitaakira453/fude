import { headOf, quoteBlocks, type Resolution } from "./blockDiff";
import {
  blockRect,
  clipRects,
  rangeAt,
  readBlockText,
  scrollBoxOf,
} from "./domText";
import { findPlain } from "./projection";
import {
  answeredByAgent,
  REVIEW_AUTHOR,
  type AnchorHit,
  type ReviewThread,
  type ReviewUnit,
} from "./review";

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
  // 原文では引けず、似ているブロックへ寄せている（編集面だけ。読む面は
  // ブロック番号で引けるので、寄せずに出さない）。
  guess: boolean;
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
  // 1 件目の書き込み。カードからその場で書き直すのに使う。
  comment: string;
  // それを書いたのが自分か。人の言葉は書き換えられるようにしない。
  mine: boolean;
  // 最後の書き込みがエージェント。返事が返ってきていることを示す。
  answered: boolean;
}

// 何を出すか。画面ごとに矩形の作り方が違うので、出す側はこれだけを受け取る。
export interface Marked {
  marks: Mark[];
  // 書いている最中の対象。押せる印にはしない。
  pending: Rect[];
  // その対象がブロック丸ごとか。丸ごとは囲みで、範囲は文字の上のマーカーで
  // 示す（同じ見た目にすると、どちらを指しているのか読み取れない）。
  pendingWhole?: boolean;
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

// 範囲の矩形を、文字ノードごとに測って集める。
//
// Range をまとめて測ると、仕様どおり「丸ごと入っている要素の枠」も返る。
// 折り返した行や項目をまたいだ範囲では、行の箱の端まで伸びた矩形が混ざり、
// 文字の無いところまで塗られる。文字ノードごとに測れば返るのは字の箱だけで、
// 折り返しの分け方はブラウザに任せられる（選択の帯と同じ measure の仕方）。
export function textRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument ?? document;
  const from =
    root.nodeType === Node.TEXT_NODE ? (root.parentNode ?? root) : root;
  const walk = doc.createTreeWalker(from, NodeFilter.SHOW_TEXT);
  const span = doc.createRange();
  const out: DOMRect[] = [];
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const text = node as Text;
    span.selectNodeContents(text);
    // 範囲より後ろへ出た。文字ノードは本文の順に来るので、ここで終わり。
    if (span.compareBoundaryPoints(Range.END_TO_START, range) >= 0) break;
    // まだ範囲より前。
    if (span.compareBoundaryPoints(Range.START_TO_END, range) <= 0) continue;
    const s = text === range.startContainer ? range.startOffset : 0;
    const e = text === range.endContainer ? range.endOffset : text.length;
    if (e <= s) continue;
    span.setStart(text, s);
    span.setEnd(text, e);
    for (const rc of span.getClientRects()) {
      if (rc.height > 0 && rc.width > 0) out.push(rc);
    }
  }
  return out;
}

const WRAP = ".mg-table-wrap";

// 表を出すときに印を切る範囲。
//
// 表の入れ物は本文の桁いっぱいに広がるので、それで切るとブロック丸ごとの印が
// 表よりずっと広く出る。切るのは「見えている入れ物」と「表そのもの」の重なり
// （表が桁より狭いときは表の幅、桁より広いときは入れ物の見えている幅）。
export function tableClip(el: Element): DOMRect | null {
  // 編集面は節点の DOM が表の枠そのもの。読む面はブロックの入れ物の中にある。
  const wrap = el.matches(WRAP) ? el : el.querySelector(WRAP);
  if (!wrap) return null;
  const box = wrap.getBoundingClientRect();
  const table = wrap.querySelector("table");
  if (!table) return box;
  const rc = table.getBoundingClientRect();
  const left = Math.max(box.left, rc.left);
  const right = Math.min(box.right, rc.right);
  const top = Math.max(box.top, rc.top);
  const bottom = Math.min(box.bottom, rc.bottom);
  return right > left && bottom > top
    ? new DOMRect(left, top, right - left, bottom - top)
    : box;
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

// セルや箇条書きの項目の文字を丸ごと覆っている指摘。どこまでが対象かを
// ひと目で示せるよう、囲みごと 1 つの印にする。
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

// 丸ごと対象にした囲みの要素。ブロックの中の通し番号で引く。文字の一致で
// 見分けると、記法の囲みやチェックの前後で当たらないことがある。
export function unitElement(block: HTMLElement, unit: ReviewUnit): Element | null {
  const attr = unit.kind === "cell" ? "data-mg-cell" : "data-mg-item";
  return block.querySelectorAll(`[${attr}]`)[unit.index] ?? null;
}

// 丸ごと対象にした項目・セルの印。箱ではなく中の文字の幅で出す。項目の箱は
// 行の端まで伸びるので、数文字への指摘が行いっぱいの帯になる。
// 中身の無い項目は文字を持たないので、そのときだけ箱に戻る。
export function unitRects(cell: Element): DOMRect[] {
  const range = (cell.ownerDocument ?? document).createRange();
  range.selectNodeContents(cell);
  // 文字ノードだけを歩くので、チェックの箱は混ざらない。`コード` の囲みで
  // 切れた矩形は mergeRects が 1 本に畳む。
  const rects = mergeRects(textRects(range));
  return rects.length > 0 ? rects : [cell.getBoundingClientRect()];
}

// 描画側の目印（ソース位置）から通し番号を出す。台帳へは番号で残すので、
// 編集面から付けた指摘と同じ値になる。
export function unitFrom(
  content: HTMLElement,
  blockIndex: number,
  pick: { cellStart?: number; itemAnchor?: number },
): ReviewUnit | undefined {
  const block = content.querySelector<HTMLElement>(
    `[data-mg-block="${blockIndex}"]`,
  );
  if (!block) return undefined;
  const found =
    pick.cellStart !== undefined
      ? ({ attr: "data-mg-cell", anchor: pick.cellStart, kind: "cell" } as const)
      : pick.itemAnchor !== undefined
        ? ({ attr: "data-mg-item", anchor: pick.itemAnchor, kind: "item" } as const)
        : null;
  if (!found) return undefined;
  const all = [...block.querySelectorAll(`[${found.attr}]`)];
  const index = all.findIndex(
    (el) => el.getAttribute(found.attr) === String(found.anchor),
  );
  return index < 0 ? undefined : { kind: found.kind, index };
}

// 指摘の中身をカードに出すための取り出し。矩形の作り方が違っても同じ。
export function noteOf(
  thread: ReviewThread,
): Pick<Mark, "note" | "more" | "who" | "at" | "answered" | "comment" | "mine"> {
  const first = thread.comments[0];
  return {
    note: first ? first.body : "",
    more: Math.max(0, thread.comments.length - 1),
    who: first ? first.author : "",
    at: first ? first.created_at : 0,
    answered: answeredByAgent(thread),
    comment: first ? first.id : "",
    mine: first ? first.author === REVIEW_AUTHOR : false,
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
    // 今の本文に居場所を持たない指摘（消えた・見失った）は、本文に印を出さない。
    // 引用を含む近そうなブロックへ寄せていた頃は、関係の無い段落に指摘が
    // ぶら下がって読み違えのもとになった。外れた指摘はレビュー画面で辿る。
    if (!head) continue;
    const el = content.querySelector<HTMLElement>(`[data-mg-block="${head.index}"]`);
    if (!el) continue; // 漸進描画でまだ出ていない

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
    // 項目・セルを丸ごと対象にした指摘は、その箱を箇所の印にする。中身の
    // 無い項目は選択の文字を持たないので、これが無いとブロック全体への
    // 指摘と同じ見た目になる。
    const marked =
      covered > 1 || !thread.unit ? null : unitElement(el, thread.unit);
    // 図のように選べる文字を持たないブロックは範囲を作れない。枠で示す。
    const outline = blockRect(el) ?? whole?.getBoundingClientRect() ?? null;
    if (!outline) continue;

    const clip = tableClip(el);
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
    const cell = marked ?? (inner ? unitOf(inner) : null);
    const spots = cell
      ? clipRects(unitRects(cell), spotClip)
      : inner
        ? clipRects(mergeRects(textRects(inner)), spotClip)
        : [];
    // 箇所が特定できているなら外枠は添えない。塗りと枠を二重に出すと、
    // どちらへの指摘なのか読み取れない。書き換わっていることは塗りの側で示す。
    const moved = resolution.state === "rewritten";
    const shown = spots.length === 0 ? areas : [];
    if (shown.length === 0 && spots.length === 0) continue;

    const anchor = spots[0] ?? areas[0];
    const last = spots[spots.length - 1] ?? areas[0];
    out.push({
      id: thread.id,
      moved,
      guess: false,
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

  const clip = tableClip(el);
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
          ? mergeRects(textRects(range))
          : [],
    boxes.length > 0 ? clip : inBox ? inBox.getBoundingClientRect() : clip,
  ).map((rc) => relTo(base, rc));
}

import { headOf, quoteBlocks, type Resolution } from "./blockDiff";
import { splitRow } from "./blocks";
import {
  blockRect,
  clipRects,
  rangeAt,
  readBlockText,
  scrollBoxOf,
  type BlockText,
} from "./domText";
import { frozenEdge } from "./gutterGeom";
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
  // 箇所はあるのに、横に送られて枠の外へ出ているときの、潜っている側の縁。
  // これが無いと「箇所を出せない」と同じ扱いになり、ブロック全体（表まるごと）
  // が塗られて、実際よりずっと広い範囲への指摘に見える。
  edges: Rect[];
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

// その指摘が指している範囲を、横に送って見せる。
//
// 表やコードの枠の中は横にスクロールするので、縦に送っただけでは箇所が
// 画面に出ない。押したのに何も起きないように見えるので、横も合わせる。
// 置いていく先頭列の下へ送り込まないよう、その右端から先に収める。
export function showAcross(el: HTMLElement, thread: ReviewThread): void {
  const range = spotRange(el, thread);
  if (!range) return;
  const box = scrollBoxOf(range.startContainer);
  if (!box || box.scrollWidth <= box.clientWidth + 1) return;
  const rc = range.getBoundingClientRect();
  if (rc.width === 0 && rc.height === 0) return;
  const view = box.getBoundingClientRect();
  const held = frozenEdge(range.startContainer.parentElement);
  const left = Math.max(view.left, held ?? view.left) + EDGE_GAP;
  const right = view.right - EDGE_GAP;
  if (rc.left < left) box.scrollLeft -= left - rc.left;
  else if (rc.right > right) box.scrollLeft += rc.right - right;
}

// 枠の縁に残す余白。ぴったり寄せると、続きがあるのかどうか読み取れない。
const EDGE_GAP = 24;

// その指摘が指している範囲。読む面と編集面で同じ引き方をする（どちらも
// 画面に出ている字から引く）。
export function spotRange(el: HTMLElement, thread: ReviewThread): Range | null {
  if (!thread.selection) return null;
  const bt = readBlockText(el);
  const span = findPlain(bt.plain, thread.selection, thread.selection_offset);
  return span ? rangeAt(bt, span.start, span.end) : null;
}

// 潜っている側の縁。左右どちらへ隠れているかだけを、細い印で示す。
const EDGE = 4;

export function edgeRects(rects: DOMRect[], clip: DOMRect | null): DOMRect[] {
  if (!clip) return [];
  let left = false;
  let right = false;
  let top = Infinity;
  let bottom = -Infinity;
  for (const rc of rects) {
    if (rc.right <= clip.left) left = true;
    else if (rc.left >= clip.right) right = true;
    else continue;
    top = Math.min(top, rc.top);
    bottom = Math.max(bottom, rc.bottom);
  }
  if (!left && !right) return [];
  // 縦の位置は枠の中へ収める。送った先が上下にはみ出していても、縁は
  // 見えている高さに出す。
  const y0 = Math.max(clip.top, Math.min(top, clip.bottom - 1));
  const y1 = Math.min(clip.bottom, Math.max(bottom, clip.top + 1));
  const out: DOMRect[] = [];
  if (left) out.push(new DOMRect(clip.left, y0, EDGE, y1 - y0));
  if (right) out.push(new DOMRect(clip.right - EDGE, y0, EDGE, y1 - y0));
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

// 指摘した文字が今の本文に見つからないときに、せめてどの升目・項目への
// 指摘かだけでも当てる。升目の無いブロックでは当てない（ブロック全体の印のまま）。
export function unitNear(
  el: HTMLElement,
  bt: BlockText,
  thread: Pick<ReviewThread, "quote" | "selection" | "selection_offset">,
): Element | null {
  if (bt.plain.length === 0 || !el.querySelector(UNIT)) return null;
  // 表は、指摘した時点の原文で何番目の升目だったかで引く。字の位置で引くと、
  // 手前の升目が書き換わって長さが変わっただけで隣の升目に当たる。
  const index = cellInQuote(thread.quote, thread.selection, thread.selection_offset);
  if (index !== null) {
    const cell = unitElement(el, { kind: "cell", index });
    if (cell) return cell;
  }
  // 位置の直後の 1 字で引く。境目ちょうどだと手前の囲みの末尾に当たる。
  const at = Math.max(0, Math.min(thread.selection_offset, bt.plain.length - 1)) + 1;
  const node = rangeAt(bt, at, at)?.startContainer ?? null;
  const unit = node?.parentElement?.closest(UNIT) ?? null;
  return unit && el.contains(unit) ? unit : null;
}

// 引用が表なら、選んだ字を含んでいた升目の通し番号（見出し行から数える）。
// 同じ字の升目が複数あれば、字の位置に近いほうを取る。
export function cellInQuote(
  quote: string,
  selection: string,
  offset: number,
): number | null {
  const lines = quote.split("\n");
  if (lines.length < 2 || !/^\s*\|?\s*:?-{3,}/.test(lines[1])) return null;
  const needle = selection.trim();
  if (!needle) return null;
  const hits: { index: number; from: number; to: number }[] = [];
  let index = 0;
  let plain = 0;
  lines.forEach((line, i) => {
    if (i === 1 || !line.includes("|")) return;
    const parts = splitRow(line.trim());
    if (parts[0]?.trim() === "") parts.shift();
    if (parts.length > 0 && parts[parts.length - 1].trim() === "") parts.pop();
    for (const part of parts) {
      const text = part.trim();
      if (text.includes(needle)) hits.push({ index, from: plain, to: plain + text.length });
      index++;
      plain += text.length;
    }
  });
  if (hits.length === 0) return null;
  const gap = (h: { from: number; to: number }) =>
    offset < h.from ? h.from - offset : offset > h.to ? offset - h.to : 0;
  return hits.reduce((a, b) => (gap(b) < gap(a) ? b : a)).index;
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
    const lost = !inner && covered <= 1 && !!thread.selection;
    const cell =
      marked ??
      (inner ? unitOf(inner) : lost ? unitNear(el, bt, thread) : null);
    const found = cell ? unitRects(cell) : inner ? mergeRects(textRects(inner)) : [];
    const spots = clipRects(found, spotClip);
    // 箇所はあるのに、横に送られて枠の外にいる。潜っている側の縁だけを出す。
    const edges = spots.length === 0 ? edgeRects(found, spotClip) : [];
    // 箇所が特定できているなら外枠は添えない。塗りと枠を二重に出すと、
    // どちらへの指摘なのか読み取れない。書き換わっていることは塗りの側で示す。
    const moved = resolution.state === "rewritten";
    const shown = spots.length === 0 && edges.length === 0 ? areas : [];
    if (shown.length === 0 && spots.length === 0 && edges.length === 0) continue;

    const anchor = spots[0] ?? edges[0] ?? areas[0];
    const last = spots[spots.length - 1] ?? edges[0] ?? areas[0];
    out.push({
      id: thread.id,
      moved,
      guess: false,
      areas: shown.map((rc) => relTo(base, rc)),
      spots: spots.map((rc) => relTo(base, rc)),
      edges: edges.map((rc) => relTo(base, rc)),
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

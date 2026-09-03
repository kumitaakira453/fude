// 描画済みのブロックから本文だけを取り出し、選択範囲とブロック内の文字位置を
// 相互に変換する。
//
// Selection.toString() は使わない。表のセル間に \t が入るなど描画都合で
// 正規化された文字列が返り、ソースと突き合わせられなくなる。

// 画面には出るがソースには無い合成テキスト。辿るときに除く。
const SYNTHETIC = [
  ".material-symbols-rounded", // アイコンは合字なので文字として現れる
  ".mg-codeblock > div:first-child", // コードブロックの言語ラベルとコピーボタン
  ".mg-callout-k", // Note / Tip などの種別ラベル
  ".mg-hr", // editorial の「· · ·」区切り
  ".mg-lc-t > span", // リンクカードのドメイン
  ".mg-cell-editor", // 編集中の入力欄
  ".cm-editor", // その場編集で開いている生ソース
  ".katex", // 数式は別の字形に置き換わる
  "svg", // Mermaid の図
].join(",");

export interface BlockText {
  plain: string;
  runs: { node: Text; start: number }[];
}

export interface BlockSelection {
  blockIndex: number;
  start: number; // ブロック内の文字位置（開始）
  end: number; // ブロック内の文字位置（終端・排他）
  text: string;
  rect: DOMRect;
  // 表のセル・箇条書きの項目の中を選んでいるときの、その要素のソースオフセット。
  // start は画面に出ている文字の数え方なので、表では並びがソースと合わない。
  // 描画側が持っている正確な値を目印として読む。
  cellStart?: number;
  itemAnchor?: number;
  // ブロックをまたいで選んでいるときの、最後のブロックの番号とその中の
  // 終わりの位置。start / end は先頭ブロックの中の数え方なので、
  // またいでいるかどうかはここで見る。
  endBlockIndex?: number;
  endOffset?: number;
}

export function blockIndexOf(el: HTMLElement): number | null {
  const raw = el.dataset.mgBlock;
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

// ブロックの外枠。display:contents の入れ物は箱を持たないので、中の要素の
// 箱をまとめて測る。文字の範囲で測ると、コールアウトのように内側に余白を持つ
// ブロックで枠より内側に縮んでしまう。
export function blockRect(el: Element): DOMRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const kid of el.children) {
    const r = kid.getBoundingClientRect();
    if (r.height <= 0) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (right > left && bottom > top) {
    return new DOMRect(left, top, right - left, bottom - top);
  }
  // 要素を持たないブロック（文字だけ）は範囲から測る。
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  return r.height > 0 ? r : null;
}

// 本文の中で、枠の内側だけをスクロールする入れ物（横に溢れる表・コード・数式）。
const SCROLL_BOX = ".mg-table-wrap, pre, .katex-display";

// その文字が入っているスクロールする枠。重ねる印はこの枠で切らないと、
// 横にスクロールして隠れた文字の分まで枠の外へ描かれる。
export function scrollBoxOf(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest<HTMLElement>(SCROLL_BOX) ?? null;
}

// 重ねる印を、スクロールする枠の見えている範囲で切る。
export function clipRects(rects: DOMRect[], clip: DOMRect | null): DOMRect[] {
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

// 画面の上端に一番近いブロックを二分探索で探す。全部を測ると重いので、
// 1 つ目の子要素の矩形（並びは必ず上から下）で当たりを付ける。
export function topmostBlock(
  content: HTMLElement,
  viewportTop: number,
): HTMLElement | null {
  const els = content.querySelectorAll<HTMLElement>("[data-mg-block]");
  let lo = 0;
  let hi = els.length - 1;
  let hit: HTMLElement | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const box = els[mid].firstElementChild?.getBoundingClientRect();
    if (!box) {
      lo = mid + 1;
      continue;
    }
    if (box.bottom >= viewportTop) {
      hit = els[mid];
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return hit;
}

export function readBlockText(block: HTMLElement): BlockText {
  const runs: { node: Text; start: number }[] = [];
  let plain = "";
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(SYNTHETIC)) continue;
    const text = node as Text;
    runs.push({ node: text, start: plain.length });
    plain += text.nodeValue ?? "";
  }
  return { plain, runs };
}

// DOM 上の位置をブロック内の文字位置に変換する。
export function offsetOf(bt: BlockText, node: Node, offset: number): number | null {
  for (const run of bt.runs) {
    if (run.node === node) return run.start + offset;
  }
  // テキストノードではなく要素が指定された場合は、その要素に含まれる
  // 最初の本文の位置に寄せる
  for (const run of bt.runs) {
    if (node.contains(run.node)) return run.start;
  }
  return null;
}

// ブロック内の文字位置から DOM の範囲を作る。ハイライトの矩形計算に使う。
export function rangeAt(bt: BlockText, start: number, end: number): Range | null {
  const from = locate(bt, start);
  const to = locate(bt, end);
  if (!from || !to) return null;
  const range = new Range();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

function locate(bt: BlockText, offset: number): { node: Text; offset: number } | null {
  if (bt.runs.length === 0) return null;
  for (const run of bt.runs) {
    const len = run.node.nodeValue?.length ?? 0;
    if (offset <= run.start + len) {
      return { node: run.node, offset: Math.max(0, offset - run.start) };
    }
  }
  const last = bt.runs[bt.runs.length - 1];
  return { node: last.node, offset: last.node.nodeValue?.length ?? 0 };
}

// 現在の選択範囲を、ブロック内の文字位置として読む。
// ブロックをまたぐ選択は、選択が始まったブロックの末尾までに丸める。
// 要素の中の文字を丸ごと選ぶ。要素そのものを範囲にすると選択の起点が
// 要素になり、文字位置へ変換できない（readSelection が読めない）。
export function selectTextIn(el: Element): boolean {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode() as Text | null;
  if (!first) return false;
  let last = first;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    last = node as Text;
  }
  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, (last.nodeValue ?? "").length);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function readSelection(root: HTMLElement): BlockSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  const startEl =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const block = startEl?.closest<HTMLElement>("[data-mg-block]");
  if (!block) return null;
  const blockIndex = blockIndexOf(block);
  if (blockIndex === null) return null;

  const bt = readBlockText(block);
  const start = offsetOf(bt, range.startContainer, range.startOffset);
  if (start === null) return null;
  const end = block.contains(range.endContainer)
    ? offsetOf(bt, range.endContainer, range.endOffset)
    : bt.plain.length;
  if (end === null || end <= start) return null;

  const text = bt.plain.slice(start, end);
  if (!text.trim()) return null;

  const cellStart = numberFrom(startEl, "[data-mg-cell]", "mgCell");
  const itemAnchor = numberFrom(startEl, "[data-mg-item]", "mgItem");
  const span = spanEnd(root, range, blockIndex);

  return {
    blockIndex,
    start,
    end,
    text,
    rect: range.getBoundingClientRect(),
    ...(cellStart === null ? {} : { cellStart }),
    ...(itemAnchor === null ? {} : { itemAnchor }),
    ...span,
  };
}

// またいで選んだ範囲の、画面に出ている文字を全部つなげる。台帳は 1 ブロックを
// 指す作りなので、指摘には「先頭のブロック」と「選んだ全文」を持たせる。
// 断片だけを記録すると、選んだ範囲と記録が食い違う。
export function spanText(root: HTMLElement, sel: BlockSelection): string {
  const last = sel.endBlockIndex;
  if (last === undefined) return sel.text;
  const parts: string[] = [];
  for (let i = sel.blockIndex; i <= last; i++) {
    const el = root.querySelector<HTMLElement>(`[data-mg-block="${i}"]`);
    if (!el) continue;
    const { plain } = readBlockText(el);
    if (i === sel.blockIndex) parts.push(plain.slice(sel.start));
    else if (i === last) parts.push(plain.slice(0, sel.endOffset ?? plain.length));
    else parts.push(plain);
  }
  return parts.filter((t) => t.trim() !== "").join("\n\n");
}

// その位置が入っているブロックの入れ物。またぐ選択では、終わりが文字ではなく
// 入れ物（記事の要素）で示されることがある。その場合は指している子から辿る。
function blockOf(node: Node, offset: number): HTMLElement | null {
  if (!(node instanceof Element)) {
    return node.parentElement?.closest<HTMLElement>("[data-mg-block]") ?? null;
  }
  // 入れ物が示す位置は「そこまで」なので、1 つ手前の子が最後の中身になる。
  const kid = node.childNodes[offset - 1] ?? node.childNodes[offset] ?? null;
  const from =
    kid instanceof Element ? kid : (kid?.parentElement ?? (node as Element));
  const hit = from.closest<HTMLElement>("[data-mg-block]");
  if (hit) return hit;
  // 入れ物そのものを指しているときは、その中の最後のブロックを採る。
  const inside = from.querySelectorAll<HTMLElement>("[data-mg-block]");
  return inside.length > 0 ? inside[inside.length - 1] : null;
}

// ブロックをまたいでいるときの、最後のブロックと、その中の終わりの位置。
// またいでいなければ空を返す。
function spanEnd(
  root: HTMLElement,
  range: Range,
  blockIndex: number,
): { endBlockIndex?: number; endOffset?: number } {
  if (!root.contains(range.endContainer)) return {};
  const endBlock = blockOf(range.endContainer, range.endOffset);
  const at = endBlock ? blockIndexOf(endBlock) : null;
  if (!endBlock || at === null || at <= blockIndex) return {};
  const bt = readBlockText(endBlock);
  const offset = offsetOf(bt, range.endContainer, range.endOffset);
  // 位置が読めない終わり方（入れ物が終端など）でも、またいでいる事実は残す。
  // 末尾まで選んだものとして扱う。
  if (offset === null) return { endBlockIndex: at, endOffset: bt.plain.length };
  // 最後のブロックの文字を 1 つも含まない終わり方は、またぎとして扱わない。
  // 段落の行末より少し下まで引いただけで次のブロックを巻き込んでしまう。
  if (offset <= 0) return {};
  return { endBlockIndex: at, endOffset: offset };
}

// 選択の起点から最も近い目印を辿って数値を読む。
function numberFrom(
  from: Element | null | undefined,
  selector: string,
  key: string,
): number | null {
  const el = from?.closest<HTMLElement>(selector);
  const raw = el?.dataset[key];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

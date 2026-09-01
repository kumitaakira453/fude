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
}

export function blockIndexOf(el: HTMLElement): number | null {
  const raw = el.dataset.mgBlock;
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
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

  return {
    blockIndex,
    start,
    end,
    text,
    rect: range.getBoundingClientRect(),
    ...(cellStart === null ? {} : { cellStart }),
    ...(itemAnchor === null ? {} : { itemAnchor }),
  };
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

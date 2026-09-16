import type { Node as PmNode, NodeType } from "prosemirror-model";
import {
  coverage,
  headOf,
  probeOf,
  quoteBlocks,
  stripMarkup,
  type Resolution,
} from "../blockDiff";
import { slugsOf } from "../anchors";
import type { ReviewThread, ReviewUnit } from "../review";
import type { Loaded } from "./fromMarkdown";
import { schema } from "./schema";
import { toMarkdownParts, type Part } from "./toMarkdown";

// 指摘の居場所を、編集面の節点へ当てる。
//
// 台帳はブロック番号を持たない。持っているのは指摘した時点のブロックの原文
// （quote）と、そこからの対応付けで出した「今どのブロックか」（Resolution）。
// 読むときは目印（data-mg-block）で引けるが、編集面の DOM は ProseMirror が
// 持っていて目印を足せない。**原文の突き合わせで節点を決める。**
//
// 決めた先は編集モデルの位置として持ち回す（anchors.ts）。位置は transaction で
// 写せるので、打っている間に決め直さなくてよい。

export interface Anchored {
  id: string;
  // トップレベルの節点の位置。
  pos: number;
  // またいだ指摘で覆っているブロックの数。
  covered: number;
  // 対象が書き換わっている。
  moved: boolean;
  // 位置が特定できず、近いブロックに寄せている。
  guess: boolean;
}

// 寄せるかどうかの線。読むとき側の mostSimilar と同じ。似ているだけの節点へは
// 寄せない（書き換えられた文書で、確信をもって別の箇所を指してしまう）。
const PRESENT = 0.9;

export function anchorThreads(
  doc: PmNode,
  loaded: Loaded,
  threads: ReviewThread[],
  resolutions: Map<string, Resolution>,
): Anchored[] {
  if (threads.length === 0) return [];
  const { parts } = toMarkdownParts(doc, loaded);
  const out: Anchored[] = [];
  for (const thread of threads) {
    const resolution = resolutions.get(thread.id);
    if (!resolution) continue;
    const head = headOf(resolution);
    // 今の本文に居場所を持たない指摘（消えた・見失った）は、節点に当てない。
    // 近そうな節点へ寄せると、関係の無い段落に指摘がぶら下がる。
    if (!head) continue;
    const at = exact(parts, head.src, head.index);
    // 原文では引けないことがある（囲みの読み分けで綴りがずれる）。
    // その救済としてだけ、似ている節点へ寄せる。
    const index = at >= 0 ? at : similar(parts, thread);
    if (index < 0) continue;
    out.push({
      id: thread.id,
      pos: parts[index].pos,
      covered: quoteBlocks(thread.quote).length,
      moved: at < 0 || resolution.state === "rewritten",
      guess: at < 0,
    });
  }
  return out;
}

// 原文がそのまま残っている節点。同じ原文の節点が複数あるときは、読むとき側の
// ブロック番号に近い方を採る（囲みの読み分けで番号がずれることがあるので、
// 一致では引かない）。
function exact(parts: Part[], src: string, near: number): number {
  const want = src.trim();
  let best = -1;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].src.trim() !== want) continue;
    if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) best = i;
  }
  return best;
}

// 原文では引けないとき、引用をほぼ丸ごと含んでいる節点へ寄せる。
function similar(parts: Part[], thread: ReviewThread): number {
  const probe = probeOf(thread.quote, thread.selection);
  if (!probe) return -1;
  let best = -1;
  let top = 0;
  let second = 0;
  for (let i = 0; i < parts.length; i++) {
    const score = coverage(probe, stripMarkup(parts[i].src));
    if (score > top) {
      second = top;
      top = score;
      best = i;
    } else if (score > second) {
      second = score;
    }
  }
  if (top < PRESENT) return -1;
  // ほぼ丸ごと含む節点が 2 つ以上あるときは決められない。
  return second >= PRESENT ? -1 : best;
}

// その位置を含む節の id。手前の見出しを遡って探す。
//
// 見出しの字から id を作るのは読む面と同じ道（slugsOf）。同じ順で回すので、
// 同じ見出しが複数ある文書でも連番まで画面と一致する。
export function anchorTo(doc: PmNode, pos: number): string | null {
  const heads: { at: number; text: string }[] = [];
  let at = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type.name === "heading") heads.push({ at, text: node.textContent });
    at += node.nodeSize;
  }
  const ids = slugsOf(heads.map((h) => h.text));
  let found: string | null = null;
  heads.forEach((h, i) => {
    if (h.at <= pos && ids[i]) found = ids[i];
  });
  return found;
}

// その id を持つ見出しの位置。編集面には id が無いので、字から作り直して探す。
export function posOfAnchor(doc: PmNode, id: string): number | null {
  const heads: { at: number; text: string }[] = [];
  let at = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type.name === "heading") heads.push({ at, text: node.textContent });
    at += node.nodeSize;
  }
  const ids = slugsOf(heads.map((h) => h.text));
  const found = ids.indexOf(id);
  return found < 0 ? null : heads[found].at;
}

// 指摘に持たせる見出しの道筋。手前の見出しの節点から組む。
export function sectionPathTo(doc: PmNode, pos: number): string[] {
  const stack: { depth: number; text: string }[] = [];
  let at = 0;
  for (let i = 0; i < doc.childCount && at < pos; i++) {
    const node = doc.child(i);
    at += node.nodeSize;
    if (node.type.name !== "heading") continue;
    const depth = Number(node.attrs.level) || 1;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    stack.push({ depth, text: node.textContent.trim() });
  }
  return stack.map((s) => s.text);
}

// ---- 編集面から指摘を付けるときの対象 ----
//
// 台帳は「指摘した時点で画面に出ていた全文」を版として受け取る作りなので、
// ディスクへ書き出さずに、いま編集面が持っている全文をそのまま渡せる。
// 居場所は番号ではなく引用の突き合わせで出すため、これで足りる。

export interface Target {
  // 対象のトップレベルの節点。印を出す先。
  pos: number;
  // 選んだ範囲（編集モデルの位置）。ブロック丸ごとなら持たない。
  spot: { from: number; to: number } | null;
  // そのブロックの Markdown。
  quote: string;
  // 選んだ表示文字と、ブロックの中でのその位置。
  text: string;
  offset: number;
  sectionPath: string[];
  // 版として残す全文。フロントマターを前に付けたもの。
  source: string;
  // 項目・セルを丸ごと相手にしているときの引き先。中身の無い項目は選んだ
  // 文字を持たないので、これが無いとブロック全体への指摘と区別が付かない。
  unit?: ReviewUnit;
}

// 範囲が入っている項目・セル。ブロックの中で何番目かを返す（読む側の目印は
// 編集面に無いので、どちらの面でも作れる通し番号で持つ）。
function unitAt(
  doc: PmNode,
  blockPos: number,
  from: number,
): ReviewUnit | undefined {
  const $from = doc.resolve(from);
  const item = schema.nodes.listItem;
  const cell = schema.nodes.tableCell;
  let held: { type: NodeType; at: number } | null = null;
  for (let d = $from.depth; d > 0; d--) {
    const type = $from.node(d).type;
    if (type === cell || type === item) {
      held = { type, at: $from.before(d) };
      break;
    }
  }
  if (!held) return undefined;
  const block = doc.nodeAt(blockPos);
  if (!block) return undefined;
  let index = -1;
  let seen = 0;
  block.descendants((node, offset) => {
    if (node.type !== held.type) return true;
    if (blockPos + 1 + offset === held.at) index = seen;
    seen++;
    return true;
  });
  if (index < 0) return undefined;
  return { kind: held.type === cell ? "cell" : "item", index };
}

// 中身を持たない行内を字として読むときの代わり。
//
// 数式は原文の書き方（$…$）で読む。何も返さないと、式を含む範囲を引用したときに
// 引用文から式が抜け落ちる（居場所の突き合わせも原文と食い違う）。
const leafText = (node: PmNode): string =>
  node.type === schema.nodes.inlineMath
    ? ((node.attrs.raw as string | null) ?? `$${node.attrs.tex as string}$`)
    : "";

// 選んだ範囲を対象にする。範囲がブロックをまたぐときは、始まったブロックの
// 終わりまでに丸める（読むとき側の readSelection と同じ扱い）。
export function targetOfSpan(
  doc: PmNode,
  loaded: Loaded,
  prefix: string,
  from: number,
  to: number,
): Target | null {
  const $from = doc.resolve(from);
  if ($from.depth === 0) return null;
  const pos = $from.before(1);
  const node = doc.nodeAt(pos);
  if (!node) return null;
  const end = Math.min(to, pos + node.nodeSize - 1);
  if (end <= from) return null;
  const built = build(doc, loaded, prefix, pos);
  if (!built) return null;
  return {
    ...built,
    spot: { from, to: end },
    text: doc.textBetween(from, end, "", leafText),
    offset: doc.textBetween(pos + 1, from, "", leafText).length,
    unit: unitAt(doc, pos, from),
  };
}

// ブロック丸ごとを対象にする。箇所を持たないので、印は外枠だけになる。
export function targetOfBlock(
  doc: PmNode,
  loaded: Loaded,
  prefix: string,
  pos: number,
): Target | null {
  const built = build(doc, loaded, prefix, pos);
  return built ? { ...built, spot: null, text: "", offset: 0 } : null;
}

function build(
  doc: PmNode,
  loaded: Loaded,
  prefix: string,
  pos: number,
): Omit<Target, "spot" | "text" | "offset"> | null {
  const { text, parts } = toMarkdownParts(doc, loaded);
  const part = parts.find((p) => p.pos === pos);
  if (!part) return null;
  return {
    pos,
    quote: part.src,
    sectionPath: sectionPathTo(doc, pos),
    source: prefix + text,
  };
}

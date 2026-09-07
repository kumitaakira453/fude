import type { Node as PmNode } from "prosemirror-model";
import {
  coverage,
  headOf,
  probeOf,
  quoteBlocks,
  stripMarkup,
  type Resolution,
} from "../blockDiff";
import type { ReviewThread } from "../review";
import type { Loaded } from "./fromMarkdown";
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

// 寄せるかどうかの線。読むとき側の mostSimilar と同じ考え方で、僅差では
// 寄せない（言い回しの似た段落が並ぶ文書で、確信をもって別の箇所を指す）。
const ENOUGH = 0.62;
const MARGIN = 0.12;

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
    const at = head
      ? exact(parts, head.src, head.index)
      : -1;
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

// 書き換わって原文では引けないとき、引用を一番含んでいる節点へ寄せる。
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
  if (top < ENOUGH) return -1;
  return top >= 0.9 || top - second >= MARGIN ? best : -1;
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

import {
  diffBlocks,
  headIndexAt,
  probeOf,
  rankByCoverage,
  resolveInDiff,
  targetIndex,
  type BlockChange,
} from "./blockDiff";
import { splitBlocks, type Block } from "./blocks";
import { charDiff } from "./charDiff";
import { parseFrontmatter } from "./frontmatter";
import { buildProjection, findPlain, findPlainLoose } from "./projection";
import type { ReviewThread } from "./review";

// 指摘の箇所が、コメントしてから今までにどうなったか。
//
// 指摘は必ず基準版（その時点の全文）を持っている。今の本文と突き合わせれば、
// 「書き換わった」で止めずに、どの字が消えてどの字が入ったかまで出せる。
//
// 「同じブロックの別の箇所だけが動いた」を独立した状態として持つ。指摘した文が
// そのまま残っているかどうかは、応えてもらえたかを読む人が真っ先に見る点で、
// ブロックが変わったという一括りの言い方では読み取れない。

export type SpotState =
  | "untouched" // ブロックがそのまま
  | "around" // 指摘した文はそのまま。同じブロックの別の箇所が変わった
  | "rewritten" // 指摘の箇所そのものが書き換わった
  | "removed" // ブロックごと消えた
  | "unknown"; // 見失った

export interface SpotDiff {
  state: SpotState;
  // 今の本文でのブロック番号。unknown のときは -1。
  index: number;
  // コメント時点のブロック原文。版を引けなかったときは null。
  before: string | null;
  added: number;
  removed: number;
  // 見失ったときの、近そうなブロック。
  candidates: number[];
}

// 候補として挙げる下限と数。これ以下の重なりは手掛かりにならない。
const ENOUGH = 0.3;
const CANDIDATES = 3;

export function spotDiff(
  thread: ReviewThread,
  head: Block[],
  baseText: string | null,
): SpotDiff {
  if (baseText !== null) {
    const base = splitBlocks(parseFrontmatter(baseText).body);
    const diff = diffBlocks(base, head);
    const found = resolveInDiff(diff, thread.quote, thread.selection);
    const index = Math.min(headIndexAt(diff, found.index), head.length);
    if (found.state === "unchanged") {
      return {
        state: "untouched",
        index,
        before: found.head.src,
        added: 0,
        removed: 0,
        candidates: [],
      };
    }
    if (found.state === "removed") {
      return {
        state: "removed",
        index,
        before: found.base.src,
        added: 0,
        removed: count(text(found.base.src)),
        candidates: [],
      };
    }
    if (found.state === "rewritten") {
      return { ...within(thread, found.base.src, found.head.src), index };
    }
  }

  // 版を引けない、または基準版の側に見当たらない。今の本文から探す。
  const plain = head.map((b): BlockChange => ({ kind: "same", base: b, head: b }));
  const index = targetIndex(plain, thread.quote, thread.selection);
  if (index >= 0) {
    return {
      state: "untouched",
      index,
      before: null,
      added: 0,
      removed: 0,
      candidates: [],
    };
  }

  // 特定できないときは、引用をいくらか含んでいるブロックを近い順に示す。
  // 「分かりません」で終えると、読み手は文書全体を目で探すことになる。
  const candidates = rankByCoverage(plain, probeOf(thread.quote, thread.selection))
    .filter((c) => c.score >= ENOUGH)
    .slice(0, CANDIDATES)
    .map((c) => c.index);
  return { state: "unknown", index: -1, before: null, added: 0, removed: 0, candidates };
}

// ブロックの中で何が起きたか。指摘した文に掛かる書き換えがあったかで、
// 「箇所そのもの」と「その周り」を分ける。
function within(
  thread: ReviewThread,
  base: string,
  head: string,
): Omit<SpotDiff, "index"> {
  const before = text(base);
  const after = text(head);
  // 記法だけが違う（強調を付けた、見出しの綴りを変えた）ときは、画面に出る字が
  // 変わらない。読む人にとっては動いていないので、そのままとして扱う。
  // 記法そのものを見たいときはバージョンの画面でソースを比べる。
  if (before === after) {
    return { state: "untouched", before: base, added: 0, removed: 0, candidates: [] };
  }
  const diff = charDiff(before, after);
  const added = diff.ins.reduce((n, s) => n + count(after.slice(s.from, s.to)), 0);
  const removed = diff.del.reduce((n, s) => n + count(before.slice(s.from, s.to)), 0);

  const needle = thread.selection.trim();
  // ブロック丸ごとへの指摘は箇所を持たない。動いたのは指摘の対象そのもの。
  const spot = needle
    ? (findPlain(before, needle, thread.selection_offset) ??
      findPlainLoose(before, needle))
    : null;
  // 突き合わせを諦めた（長すぎる）ときは、どこが動いたかを言えない。
  const held =
    spot !== null &&
    !diff.gaveUp &&
    !diff.del.some((s) => s.from < spot.end && s.to > spot.start) &&
    after.includes(before.slice(spot.start, spot.end));

  return {
    state: held ? "around" : "rewritten",
    before: base,
    added,
    removed,
    candidates: [],
  };
}

// ブロックの原文を、画面に出るときの字の並びへ均す。記法の綴りの違いで
// 「書き換わった」と言わないために、突き合わせは均した側で行う。
function text(src: string): string {
  return buildProjection(src).plain;
}

// 字数はコードポイントで数える。サロゲートペアを 2 と数えると、絵文字 1 つの
// 差し替えが「＋2 −2」になる。
function count(part: string): number {
  return [...part].length;
}

// 状態ごとの呼び名。一覧・状態カード・本文の札で同じ語を使う。
export const SPOT_NAME: Record<SpotState, string> = {
  untouched: "そのまま",
  around: "周りが変更",
  rewritten: "書き換え済み",
  removed: "削除済み",
  unknown: "本文から外れた",
};

export const SPOT_ICON: Record<SpotState, string> = {
  untouched: "my_location",
  around: "edit_note",
  rewritten: "difference",
  removed: "backspace",
  unknown: "help",
};

// 状態の言い切り。右の欄で、何が起きたのかを 1 文で伝える。
export function spotNote(spot: SpotDiff): string {
  switch (spot.state) {
    case "untouched":
      return "コメントの箇所は、まだ書き換わっていません。";
    case "around":
      return "指摘した文はそのままです。同じブロックの別の箇所が書き換わっています。";
    case "rewritten":
      return "指摘した箇所そのものが書き換わっています。コメント時点と並べています。";
    case "removed":
      return "コメントの箇所は、今の本文から削除されています。";
    default:
      return spot.candidates.length === 0
        ? "コメントの文は今の本文に見当たらず、近そうな箇所も見つかりませんでした。"
        : `コメントの文は今の本文に見当たりません。近そうな箇所を ${spot.candidates.length} つ挙げています。`;
  }
}

// 本文に結び付けられるか。外れた指摘は、読む面では印を出さない。
export function loose(spot: SpotDiff): boolean {
  return spot.state === "removed" || spot.state === "unknown";
}

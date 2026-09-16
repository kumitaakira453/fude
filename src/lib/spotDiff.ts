import {
  diffBlocks,
  headIndexAt,
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
  // 指摘した時点の本文（控え）を読めたか。見失ったときに、なぜ決められないのかを
  // 言い分けるのに使う。
  kept: boolean;
}

export function spotDiff(
  thread: ReviewThread,
  head: Block[],
  baseText: string | null,
): SpotDiff {
  const kept = baseText !== null;
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
        kept,
      };
    }
    if (found.state === "removed") {
      return {
        state: "removed",
        index,
        before: found.base.src,
        added: 0,
        removed: count(text(found.base.src)),
        kept,
      };
    }
    if (found.state === "rewritten") {
      return { ...within(thread, found.base.src, found.head.src), index, kept };
    }
  }

  // 版を引けない、または基準版の側に見当たらない。今の本文から探す。
  const plain = head.map((b): BlockChange => ({ kind: "same", base: b, head: b }));
  const index = targetIndex(plain, thread.quote, thread.selection);
  if (index >= 0) {
    return { state: "untouched", index, before: null, added: 0, removed: 0, kept };
  }

  // ここまでで決まらなければ、決められない。語の重なりだけで「近そうな箇所」を
  // 挙げても当たらない（実台帳で外れた指摘は、どの版にも引用の文が無かった）。
  return { state: "unknown", index: -1, before: null, added: 0, removed: 0, kept };
}

// ブロックの中で何が起きたか。指摘した文に掛かる書き換えがあったかで、
// 「箇所そのもの」と「その周り」を分ける。
function within(
  thread: ReviewThread,
  base: string,
  head: string,
): Omit<SpotDiff, "index" | "kept"> {
  const before = text(base);
  const after = text(head);
  // 記法だけが違う（強調を付けた、見出しの綴りを変えた）ときは、画面に出る字が
  // 変わらない。読む人にとっては動いていないので、そのままとして扱う。
  // 記法そのものを見たいときはバージョンの画面でソースを比べる。
  if (before === after) {
    return { state: "untouched", before: base, added: 0, removed: 0 };
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

  return { state: held ? "around" : "rewritten", before: base, added, removed };
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
      // なぜ決められないのかを言い分ける。「見当たりません」だけだと、読み手は
      // 探し直せば見つかると思ってしまう。
      return spot.kept
        ? "指摘した時点の本文が残っていません（取り込んだ指摘）。今の本文のどこを指していたかは決められません。"
        : "この指摘の基準版が残っていないため、今の本文と突き合わせられません。";
  }
}

// 本文に結び付けられるか。外れた指摘は、読む面では印を出さない。
export function loose(spot: SpotDiff): boolean {
  return spot.state === "removed" || spot.state === "unknown";
}

// 指摘の箇所の外で動いた所。
//
// コメントに応えるとき、指摘された段落ではなく別の場所を直すことがある（節を
// 足す、言い回しを他の段落と揃える）。箇所だけを見せていると、その対応そのものが
// 読めない。コメント時点の版と今を突き合わせて、動いた塊を全部拾う。
export interface Change {
  // 今の本文でのブロック番号。消えた塊は、それが在った場所の番号。
  index: number;
  kind: "changed" | "added" | "removed";
  // コメント時点の姿。足された塊は持たない。
  before: string | null;
}

export function changesSince(baseText: string, head: Block[]): Change[] {
  const base = splitBlocks(parseFrontmatter(baseText).body);
  const out: Change[] = [];
  let at = 0;
  for (const change of diffBlocks(base, head)) {
    switch (change.kind) {
      case "same":
        at++;
        break;
      case "changed":
        out.push({ index: at++, kind: "changed", before: change.base.src });
        break;
      case "added":
        out.push({ index: at++, kind: "added", before: null });
        break;
      case "removed":
        out.push({ index: at, kind: "removed", before: change.base.src });
        break;
    }
  }
  return out;
}

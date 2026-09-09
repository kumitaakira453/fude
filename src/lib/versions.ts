import { diffBlocks } from "./blockDiff";
import { splitBlocks, type Block } from "./blocks";
import { parseFrontmatter } from "./frontmatter";
import type { Ledger, ReviewVersion } from "./review";

// 版の履歴。台帳から 1 ファイル分の版を取り出し、版と版の差分を
// 読みやすい形に畳む。突き合わせそのものは blockDiff に任せる。

// 版を打った主体。
//
// 台帳の origin は「何をした時点の版か」を表しており、誰が打ったかはそこから
// 決まる。指摘を付けた時点と手で打った時点は人、対応を宣言した時点は
// エージェント（CLI の fude review commit から来る）。
export type Actor = "you" | "ai";

export function actorOf(origin: ReviewVersion["origin"]): Actor {
  return origin === "commit" ? "ai" : "you";
}

// 何をした時点の版なのか。ラベルだけでは、自分で打ったのか
// コメントやエージェントが残したのかが読めない。
export const ORIGIN_NOTE: Record<ReviewVersion["origin"], string> = {
  checkpoint: "手で打った版",
  comment: "コメントを付けた時点",
  commit: "対応を宣言した時点",
};

// そのファイルの版を新しい順に返す。
//
// macOS のファイル名は NFD で作られることがある。台帳は Rust 側で NFC に
// 正規化して書くので、こちら側の道筋も揃えないと 1 件も当たらない。
export function versionsOf(ledger: Ledger, file: string): ReviewVersion[] {
  const key = file.normalize("NFC");
  return ledger.versions
    .filter((v) => v.file.normalize("NFC") === key)
    .sort((a, b) => b.created_at - a.created_at);
}

const when = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// 版の名前。付けていなければ打った日時で呼ぶ。
export function labelOf(version: ReviewVersion): string {
  return version.label?.trim() || when.format(version.created_at);
}

// 打ってからの経過。絶対時刻だけを並べるより、古い版が古いと一目で分かる。
export function agoOf(at: number, now = Date.now()): string {
  const min = (now - at) / 60000;
  if (min < 1) return "たった今";
  if (min < 60) return `${Math.floor(min)} 分前`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} 時間前`;
  if (min < 60 * 24 * 7) return `${Math.floor(min / 60 / 24)} 日前`;
  return when.format(at);
}

// 差分の 1 行。
//
// gap は変わっていないブロックの連なりで、畳んだまま出して押されたら開く。
// meta はフロントマター。本文のブロックには割れないので、変わったときだけ
// 1 つの塊として先頭に置く。落とすと、題やタグだけを直した版が
// 「変わっていない」と出てしまう。
export type DiffRow =
  | { kind: "meta"; base: string; head: string }
  | { kind: "kept"; block: Block }
  | { kind: "gap"; blocks: Block[] }
  | { kind: "changed"; base: Block; head: Block }
  | { kind: "added"; head: Block }
  | { kind: "removed"; base: Block };

// これ以下の連なりは畳まない。1〜2 ブロックだと、畳んだ帯の方が場所を取る。
const GAP_MIN = 2;

// 変わっていないブロックの連なりを畳む。
export function foldSame(diff: ReturnType<typeof diffBlocks>): DiffRow[] {
  const rows: DiffRow[] = [];
  let run: Block[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length > GAP_MIN) rows.push({ kind: "gap", blocks: run });
    else for (const block of run) rows.push({ kind: "kept", block });
    run = [];
  };
  for (const change of diff) {
    if (change.kind === "same") {
      run.push(change.head);
      continue;
    }
    flush();
    rows.push(change);
  }
  flush();
  return rows;
}

// 2 つの版を突き合わせる。
export function compare(base: string, head: string): DiffRow[] {
  const a = parseFrontmatter(base);
  const b = parseFrontmatter(head);
  const rows = foldSame(diffBlocks(splitBlocks(a.body), splitBlocks(b.body)));
  const metaA = base.slice(0, base.length - a.body.length);
  const metaB = head.slice(0, head.length - b.body.length);
  if (metaA !== metaB) rows.unshift({ kind: "meta", base: metaA, head: metaB });
  return rows;
}

// 何も変わっていないか。差分の画面で「同じです」と言い切るのに使う。
export function unchanged(rows: DiffRow[]): boolean {
  return rows.every((row) => row.kind === "kept" || row.kind === "gap");
}

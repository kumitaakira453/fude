import { diffBlocks } from "./blockDiff";
import { splitBlocks, type Block } from "./blocks";
import { parseFrontmatter } from "./frontmatter";
import type { Ledger, ReviewVersion, VersionActor } from "./review";

// バージョンの履歴。台帳から 1 ファイル分の版を取り出し、版と版の差分を
// 読みやすい形に畳む。突き合わせそのものは blockDiff に任せる。

// 誰が残した版か。記録が無い台帳では origin から見なす。指摘を付けた時点と
// 復元前は fude が自動で残すので、人が打った版とは区別する。
export function actorOf(version: ReviewVersion): VersionActor {
  if (version.actor) return version.actor;
  if (version.origin === "commit") return "ai";
  return version.origin === "comment" ? "system" : "you";
}

export const ACTOR_NAME: Record<VersionActor, string> = {
  you: "You",
  ai: "AI",
  system: "システム",
};

export const ACTOR_ICON: Record<VersionActor, string> = {
  you: "person",
  ai: "auto_awesome",
  system: "settings",
};

// 何をした時点の版なのか。名前が付いていないときに、その代わりとして出す。
// 手で打った版は主体だけで足りるので持たない。
export const ORIGIN_NOTE: Partial<Record<ReviewVersion["origin"], string>> = {
  comment: "コメント時点",
  commit: "対応の記録",
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

const fully = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// 一覧の見出し。名前より日時を先に読ませる。名前は付けないこともあるが、
// 打った時刻はどの版にも必ずある。
export function whenOf(version: ReviewVersion): string {
  return when.format(version.created_at);
}

export function fullyOf(version: ReviewVersion): string {
  return fully.format(version.created_at);
}

// バージョンを打つときの既定の名前。名前は任意だが、空欄と向き合わせるより
// 日時が入っている方が押しやすい。一覧の見出しと同じ形にしておく。
export function defaultName(at = Date.now()): string {
  return when.format(at);
}

// 一覧の添え書き。主体と、名前（無ければ何をした時点か）を並べる。
export function noteOf(version: ReviewVersion): string {
  const parts = [ACTOR_NAME[actorOf(version)]];
  const name = version.label?.trim() || ORIGIN_NOTE[version.origin];
  // 既定の名前をそのまま打った版は、見出しの日時と同じ文字になる。
  // 2 行に同じものを並べない。
  if (name && name !== whenOf(version)) parts.push(name);
  return parts.join(" ・ ");
}

// 1 行で呼ぶときの名前。比較対象の選択や差分の見出しで使う。
export function labelOf(version: ReviewVersion): string {
  return version.label?.trim() || whenOf(version);
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

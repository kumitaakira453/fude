import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { ago } from "./when";

// レビューの台帳へのアクセス。
// 読み取りは Rust 側が書いた JSON を直接読む（IPC を挟まない）。書き込みだけを
// Tauri コマンドに任せることで、GUI と CLI の同時更新をロックで守れる。

export type ThreadStatus =
  | { kind: "open" }
  | { kind: "resolved"; by: string; at: number };

export interface ReviewComment {
  id: string;
  author: string;
  body: string;
  created_at: number;
}

// 欄の絞り込み。既定は「未対応」——読み返して手を付けるべきものだけが残る。
export type RailFilter = "todo" | "open" | "done" | "all";

export const RAIL_FILTERS: { id: RailFilter; name: string; note: string }[] = [
  { id: "todo", name: "未対応", note: "返信も解決もまだ" },
  { id: "open", name: "未解決", note: "返信済みも含む" },
  { id: "done", name: "解決済み", note: "片付いたもの" },
  { id: "all", name: "すべて", note: "" },
];

// 返信が付いているか。先頭は指摘そのものなので、2 件目から先が返信。
export const hasReply = (thread: ReviewThread): boolean => thread.comments.length > 1;

export interface ReviewThread {
  id: string;
  file: string; // 絶対パス
  quote: string; // 指摘した時点のブロック本文
  block_hash: string;
  selection: string;
  selection_offset: number;
  section_path: string[];
  // 引用の直前・直後の字。同じ文が複数あるとき、どれを指していたかを決める。
  prefix?: string;
  suffix?: string;
  // 基準版の本文の中での、引用のバイト位置。
  base_offset?: number | null;
  base_version: string;
  status: ThreadStatus;
  comments: ReviewComment[];
  created_at: number;
  resolved?: ResolvedCache | null; // GUI が対応付けた結果の控え
  unit?: ReviewUnit | null; // 項目・セルを丸ごと対象にしたときの引き先
}

// 丸ごと対象にした囲み。index はブロックの中で何番目の項目・セルか（0 から）。
//
// 中身の無い項目は選択の文字を持たない。これが無いと、ブロック全体への指摘と
// 見分けが付かない。ソースの位置ではなく通し番号で持つ。編集面は編集モデルから
// 対象を組むのでソースの位置を出せず、読む側と同じ値にならない。
export interface ReviewUnit {
  kind: "item" | "cell";
  index: number;
}

export interface ResolvedCache {
  state: ResolvedState;
  head_quote: string;
  at: number;
  // CLI が解いた居場所。バイト範囲が正準で、行番号は読む人のために添える。
  range?: ByteRange | null;
  method?: string | null;
  score?: number | null;
}

export interface ByteRange {
  start: number;
  end: number;
  line_start: number;
  line_end: number;
}

// 版を残した主体。origin（何をした時点か）とは別の軸。手で打った版と
// エージェントが打った版は、どちらも checkpoint になる。
export type VersionActor = "you" | "ai" | "system";

export interface ReviewVersion {
  id: string;
  file: string;
  label: string | null;
  origin: "comment" | "commit" | "checkpoint";
  // 主体が記録される前の台帳には無い。読む側は origin から見なす。
  actor?: VersionActor | null;
  // この版がどの指摘への対応か（対応の記録に添える）。紐付けの無い記録は空。
  threads?: string[];
  created_at: number;
}

export interface Ledger {
  format_version: number;
  threads: ReviewThread[];
  versions: ReviewVersion[];
}

export const EMPTY_LEDGER: Ledger = {
  format_version: 1,
  threads: [],
  versions: [],
};

// GUI から書いた指摘・返信・解決の記録者。CLI 側の既定は "AI"。
export const REVIEW_AUTHOR = "you";

// 小窓を出す位置。ビューポート座標。
export interface AnchorHit {
  id: string;
  top: number;
  bottom: number;
  left: number;
}

export function isOpen(thread: ReviewThread): boolean {
  return thread.status.kind === "open";
}

let storePathCache: string | null = null;

// 台帳の置き場所。読むだけでなく、見張る側も同じ道を使う。
export async function ledgerPath(): Promise<string> {
  if (!storePathCache) storePathCache = await invoke<string>("review_store_path");
  return storePathCache;
}

// 読み込んだ台帳と、その素の字。字をそのまま返すのは、読み直したときに
// 「前と同じ中身か」を突き合わせるため（同じなら差し替えずに済む）。
export interface LoadedLedger {
  ledger: Ledger;
  text: string;
}

export async function loadLedger(): Promise<Ledger> {
  return (await readLedger()).ledger;
}

export async function readLedger(): Promise<LoadedLedger> {
  try {
    const text = await readTextFile(await ledgerPath());
    const parsed = JSON.parse(text) as Ledger;
    return {
      ledger: {
        format_version: parsed.format_version ?? 1,
        threads: parsed.threads ?? [],
        versions: parsed.versions ?? [],
      },
      text,
    };
  } catch {
    // まだ 1 件も指摘が無ければ台帳のファイルが存在しない
    return { ledger: EMPTY_LEDGER, text: "" };
  }
}

// 版の本文を読む。版 ID は内容ハッシュなので中身が変わることはなく、
// キャッシュの無効化を考える必要がない。
const versionCache = new Map<string, string | null>();

export async function readVersion(id: string): Promise<string | null> {
  if (!id) return null;
  const cached = versionCache.get(id);
  if (cached !== undefined) return cached;
  let text: string | null = null;
  try {
    text = await invoke<string>("review_version_text", { id });
  } catch {
    // 版の実体が無い（取り込み元にスナップショットが無かった等）
    text = null;
  }
  versionCache.set(id, text);
  return text;
}

// 人が明示的に打つ版。画面に出ている本文をそのまま渡す（ディスクの内容ではなく
// これを渡すので、版と画面に出ていたものが食い違わない）。
export interface Checkpointed {
  id: string;
  // 同じ内容の版が既にあったときは false。押しても履歴が増えないことを言う。
  created: boolean;
}

export async function createCheckpoint(
  file: string, // 絶対パス
  text: string,
  label: string | null,
): Promise<Checkpointed | null> {
  return call(
    () => invoke<Checkpointed>("review_checkpoint", { file, text, label }),
    "バージョンを保存できませんでした",
  );
}

export interface Restored {
  // 書き戻した本文。
  text: string;
  // 復元の直前の本文の版。ここへ復元し直せば取り消せる。
  backup: string;
}

// 過去の版でファイルを置き換える。expect は画面が基準にしている本文で、
// ディスクがそれと違えば Rust 側が何もせずにエラーを返す。
export async function restoreVersion(
  file: string,
  version: string,
  expect: string,
): Promise<Restored | null> {
  return call(
    () => invoke<Restored>("review_restore", { file, version, expect }),
    "復元できませんでした",
  );
}

// 名前が変わったファイルの指摘と版を、新しいパスへ連れていく。台帳は絶対パスで
// 紐付いているので、呼ばないと名前を変えた時点でその指摘が引けなくなる。
export async function moveReviewFile(from: string, to: string): Promise<void> {
  try {
    await invoke<number>("review_move_file", { from, to });
  } catch {
    // 付け替えられなくても本文の表示には影響しないので黙って諦める
  }
}

// 解決結果を台帳に控える。CLI は Markdown を解析しないため、GUI が対応付けた
// 結果をここに置いて読ませる。headQuote は解決時点の「現在のブロック本文」で、
// CLI はそれが今のファイルに含まれるかでキャッシュの新しさを自分で判定できる。
export type ResolvedState = "unchanged" | "rewritten" | "removed" | "unknown";

export async function setResolved(
  thread: string,
  state: ResolvedState,
  headQuote: string,
): Promise<void> {
  try {
    await invoke("review_set_resolved", { thread, state, headQuote });
  } catch {
    // 控えが書けなくても画面の表示には影響しないので黙って諦める
  }
}

export interface NewThreadInput {
  file: string; // 絶対パス
  quote: string; // ブロックの生ソース
  selection: string; // 選択された本文
  selectionOffset: number; // ブロック内の文字位置
  sectionPath: string[];
  source: string; // 指摘した時点で画面に出ていた全文
  author: string;
  body: string;
  unit?: ReviewUnit; // 項目・セルを丸ごと対象にしたとき
}

// 版は「画面に出ていた全文」から作る。ディスクの内容ではなくこれを渡すので、
// 指摘とその基準版が食い違わない。
export async function createThread(input: NewThreadInput): Promise<string | null> {
  return call(() => invoke<string>("review_create_thread", { ...input }), "コメントを作成できませんでした");
}

export async function replyToThread(
  thread: string,
  author: string,
  body: string,
): Promise<boolean> {
  return attempt(
    () => invoke("review_reply", { thread, author, body }),
    "返信できませんでした",
  );
}

// 指摘そのものを取り消す。解決（片付いた記録が残る）とは別の意味の操作。
export async function removeThread(thread: string): Promise<boolean> {
  return attempt(
    () => invoke("review_remove", { thread }),
    "コメントを取り消せませんでした",
  );
}

// 書き込みを書き直す。
export async function editComment(
  thread: string,
  comment: string,
  body: string,
): Promise<boolean> {
  return attempt(
    () => invoke("review_edit_comment", { thread, comment, body }),
    "書き込みを直せませんでした",
  );
}

// 最後の書き込みが AI かどうか。一覧で返信が来ているかを示すのに使う。
export function answeredByAgent(thread: ReviewThread): boolean {
  const last = thread.comments[thread.comments.length - 1];
  return !!last && AGENTS.has(last.author);
}

export async function resolveThread(thread: string, by: string): Promise<boolean> {
  return attempt(
    () => invoke("review_resolve", { thread, by }),
    "解決にできませんでした",
  );
}

// 消した指摘をそのまま戻す。id も会話も時刻も元のままなので、戻したあとの
// 印と並びが消す前と変わらない。
export async function restoreThread(thread: ReviewThread): Promise<boolean> {
  return attempt(
    () => invoke("review_put_thread", { thread }),
    "コメントを戻せませんでした",
  );
}

// 解決を取り消して未解決に戻す。
export async function reopenThread(thread: string): Promise<boolean> {
  return attempt(
    () => invoke("review_reopen", { thread }),
    "解決を取り消せませんでした",
  );
}

// 指摘をまとめて解決にする。1 ファイル分を片付けるときに使う。
// 台帳のロックを 1 回しか取らないので、途中で止まって半端に終わることがない。
// 戻り値は解決にした件数。失敗したときは null。
export async function resolveThreads(threads: string[], by: string): Promise<number | null> {
  return call(
    () => invoke<number>("review_resolve_many", { threads, by }),
    "まとめて解決にできませんでした",
  );
}

// 指摘の書き手。エージェントの返信は指摘そのものではないので数えない。
const AGENTS = new Set(["AI", "ai", "assistant", "claude"]);

const QUOTE_LIMIT = 120;

function oneLine(text: string, limit = QUOTE_LIMIT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

// 指摘 1 件に添える、画面が突き合わせて分かったこと。
// 突き合わせが済んでいないものは持たない（その旨を写しに出す）。
export interface ThreadFacts {
  // 見出しを辿った道筋。
  where: string;
  // 箇所が今どうなっているか（そのまま / 書き換え済み など）の呼び名。
  state: string;
  // 今の本文での行。見失っているときは無い。
  lines?: { from: number; to: number } | null;
  // 今のブロックの原文。書き換わっているときだけ添える。
  head?: string | null;
  // その箇所を指すページ内リンク。人が押して飛べる形で渡す。
  anchor?: string | null;
}

// 指摘を、そのままエージェントに渡せる形にする。
//
// CLI（fude review list --format agent）と同じ並びにする。同じ台帳を人と
// エージェントが別の口から読むので、形が違うと指示が食い違う。
// 版のハッシュや絶対時刻のような、読んでも行動が変わらないものは出さない。
export function reviewPrompt(
  file: string,
  threads: ReviewThread[],
  facts: (thread: ReviewThread) => ThreadFacts | undefined,
): string {
  const head = `${file}\n未解決 ${threads.length} 件\n`;
  return [head, ...threads.map((t) => section(t, facts(t))), after(file, threads)].join(
    "\n",
  );
}

// 直したあとに何を打つか。
//
// 対応の記録（commit）を打ってもらえると、画面は「その対応で本文のどこが動いたか」
// を指摘の箇所の外まで含めて出せる。打たれていないと、コメント時点から今までの
// 変更しか出せず、関係のない編集が混ざる。
function after(file: string, threads: ReviewThread[]): string {
  const ids = threads.map((t) => `--thread ${t.id}`).join(" ");
  return [
    "直したら:",
    `  fude review reply --thread <id> --message "何をしたか"`,
    `  fude review commit --file "${file}" --message "何を直したか" ${ids}`,
    "",
  ].join("\n");
}

function section(thread: ReviewThread, facts: ThreadFacts | undefined): string {
  const lines = [
    `#${thread.id}  ${answeredByAgent(thread) ? "返信済み" : "未対応"}${
      facts ? `  ${facts.state}` : ""
    }`,
    `場所: ${facts?.where?.trim() || sectionOf(thread)}`,
    `位置: ${whereLine(facts)}`,
  ];
  // 選択がブロックぜんたいと同じときは、下の「本文」と同じ字になる。
  if (thread.selection.trim() && thread.selection.trim() !== thread.quote.trim()) {
    lines.push(`選択: ${oneLine(thread.selection)}`);
  }
  if (facts?.anchor) lines.push(`アンカー: ${facts.anchor}`);
  lines.push("本文:", quoted(thread.quote));
  if (facts?.head) lines.push("現在:", quoted(facts.head));
  if (thread.comments.length > 0) {
    lines.push("会話:");
    for (const c of thread.comments) {
      lines.push(`- ${c.author} (${ago(c.created_at)}): ${c.body.trim().replace(/\n/g, "\n  ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function sectionOf(thread: ReviewThread): string {
  return thread.section_path.length > 0 ? thread.section_path.join(" › ") : "(ファイル先頭)";
}

function whereLine(facts: ThreadFacts | undefined): string {
  if (!facts) return "突き合わせ前";
  if (!facts.lines) return "今の本文には無い";
  const { from, to } = facts.lines;
  return from === to ? `${from} 行` : `${from}–${to} 行`;
}

function quoted(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

// 値を返さないコマンド用。Rust の Ok(()) は JS では null として届くので、
// 戻り値の有無では成功と失敗を見分けられない。例外が出たかどうかで判定する。
async function attempt(run: () => Promise<unknown>, failure: string): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (e) {
    await message(`${failure}\n${String(e)}`, { title: "fude", kind: "error" });
    return false;
  }
}

// 失敗を握り潰さず理由を出す。押しても何も起きない状態を作らない。
async function call<T>(run: () => Promise<T>, failure: string): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    await message(`${failure}\n${String(e)}`, { title: "fude", kind: "error" });
    return null;
  }
}

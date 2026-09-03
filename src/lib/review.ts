import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

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

export interface ReviewThread {
  id: string;
  file: string; // 絶対パス
  quote: string; // 指摘した時点のブロック本文
  block_hash: string;
  selection: string;
  selection_offset: number;
  section_path: string[];
  base_version: string;
  status: ThreadStatus;
  comments: ReviewComment[];
  created_at: number;
  resolved?: ResolvedCache | null; // GUI が対応付けた結果の控え
}

export interface ResolvedCache {
  state: ResolvedState;
  head_quote: string;
  at: number;
}

export interface ReviewVersion {
  id: string;
  file: string;
  label: string | null;
  origin: "comment" | "commit" | "checkpoint";
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

async function storePath(): Promise<string> {
  if (!storePathCache) storePathCache = await invoke<string>("review_store_path");
  return storePathCache;
}

export async function loadLedger(): Promise<Ledger> {
  try {
    const text = await readTextFile(await storePath());
    const parsed = JSON.parse(text) as Ledger;
    return {
      format_version: parsed.format_version ?? 1,
      threads: parsed.threads ?? [],
      versions: parsed.versions ?? [],
    };
  } catch {
    // まだ 1 件も指摘が無ければ台帳のファイルが存在しない
    return EMPTY_LEDGER;
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
}

// 版は「画面に出ていた全文」から作る。ディスクの内容ではなくこれを渡すので、
// 指摘とその基準版が食い違わない。
export async function createThread(input: NewThreadInput): Promise<string | null> {
  return call(() => invoke<string>("review_create_thread", { ...input }), "指摘を作成できませんでした");
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
    "指摘を取り消せませんでした",
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

// 指摘と指摘の境目。指摘の本文が複数行に渡ると、空行だけでは切れ目が読めない。
const SEPARATOR = "=".repeat(56);

function oneLine(text: string, limit = QUOTE_LIMIT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

// 指摘をそのまま人に渡せる短い文にする。ID や版、解決の手順は載せない。
// どのファイルのどこに何を言われたか、それだけで軽い修正は足りる。
export function reviewPrompt(
  file: string,
  threads: ReviewThread[],
  where: (thread: ReviewThread) => string,
): string {
  const items = threads.map((t) => {
    const spot = where(t).trim();
    const target = oneLine(t.selection.trim() || t.quote);
    const says = t.comments
      .filter((c) => !AGENTS.has(c.author))
      .map((c) => c.body.trim())
      .filter(Boolean)
      .join("\n    ");
    const lines = [spot ? `- ${spot}` : "-"];
    if (target) lines.push(`    該当箇所: ${target}`);
    if (says) lines.push(`    指摘: ${says}`);
    return lines.join("\n");
  });
  return `${file}\n\n${items.join(`\n\n${SEPARATOR}\n\n`)}\n`;
}

// 値を返さないコマンド用。Rust の Ok(()) は JS では null として届くので、
// 戻り値の有無では成功と失敗を見分けられない。例外が出たかどうかで判定する。
async function attempt(run: () => Promise<unknown>, failure: string): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (e) {
    await message(`${failure}\n${String(e)}`, { title: "mdglow", kind: "error" });
    return false;
  }
}

// 失敗を握り潰さず理由を出す。押しても何も起きない状態を作らない。
async function call<T>(run: () => Promise<T>, failure: string): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    await message(`${failure}\n${String(e)}`, { title: "mdglow", kind: "error" });
    return null;
  }
}

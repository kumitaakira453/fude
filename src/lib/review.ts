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

// 指摘の対象が今の本文に残っているか。指摘の状態（未解決 / 解決済み）とは別の軸。
export type AnchorState = "ok" | "stale";

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

export function anchorStateOf(thread: ReviewThread, body: string): AnchorState {
  return body.includes(thread.quote) ? "ok" : "stale";
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

// 版の本文を読む。差分表示に使う。
export async function readVersion(id: string): Promise<string | null> {
  if (!id) return null;
  try {
    return await invoke<string>("review_version_text", { id });
  } catch {
    // 版の実体が無い（取り込み元にスナップショットが無かった等）
    return null;
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
  return (await call(() => invoke("review_reply", { thread, author, body }), "返信できませんでした")) !== null;
}

export async function resolveThread(thread: string, by: string): Promise<boolean> {
  return (await call(() => invoke("review_resolve", { thread, by }), "解決にできませんでした")) !== null;
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
